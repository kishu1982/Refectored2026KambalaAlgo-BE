import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';

import { OrdersService } from 'src/orders/orders.service';
import { MarketService } from 'src/market/market.service';

import { ExchangeOrder } from './exchange-entities/exchange-order.entity';
import { ExchangeTrade } from './exchange-entities/exchange-trade.entity';
import { ExchangeNetPosition } from './exchange-entities/exchange-net-position.entity';
import { ConfigService } from '@nestjs/config';

import { Cron } from '@nestjs/schedule';

@Injectable()
export class ExchangeDataService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeDataService.name);
  private readonly MAGIC_NUMBER: string; // diclaring magic number
  private clientUid = ''; // for future use if needed in filter or anywhere else, can be set from env or config

  // ⭐ queue lock
  private syncPromise: Promise<void> = Promise.resolve();

  // ⭐ memory cache
  private orderCache: any[] = [];
  private tradeCache: any[] = [];
  private netPositionCache: any[] = [];

  private lastForceSync = 0; // added THROTTLE

  constructor(
    @InjectRepository(ExchangeOrder)
    private readonly orderRepo: MongoRepository<ExchangeOrder>,

    @InjectRepository(ExchangeTrade)
    private readonly tradeRepo: MongoRepository<ExchangeTrade>,

    @InjectRepository(ExchangeNetPosition)
    private readonly netPositionRepo: MongoRepository<ExchangeNetPosition>,

    private readonly ordersService: OrdersService,
    private readonly marketService: MarketService,
    private readonly configService: ConfigService,
  ) {
    // this.MAGIC_NUMBER = this.configService.get<string>('MAGIC_NUMBER') || '';
    const magic = this.configService.get<string>('MAGIC_NUMBER');

    if (!magic) {
      throw new Error('MAGIC_NUMBER is not defined in environment variables');
    }

    this.MAGIC_NUMBER = magic;
    this.clientUid = this.configService.get<string>('NOREN_CLIENT_ID') || '';
  }

  // --------------------------------
  // MODULE INIT
  // --------------------------------

  async onModuleInit() {
    try {
      this.logger.log('ExchangeDataService initialized');

      await this.queueSync(async () => {
        await this.safeSync(() => this.syncOrderBook());
        await this.safeSync(() => this.syncTradeBook());
        await this.safeSync(() => this.syncNetPositions());
      });

      await this.loadAllCachesFromDB();
    } catch (err) {
      this.logger.error('Module init failed', err?.stack || err);
    }
  }

  // --------------------------------
  // SAFE QUEUE
  // --------------------------------

  async queueSync(fn: () => Promise<void>) {
    this.syncPromise = this.syncPromise
      .then(() => fn())
      .catch((err) => {
        this.logger.error('Queue error', err?.stack || err);
      });

    return this.syncPromise;
  }

  // --------------------------------
  // FOR GIVING CLINET ID ON WHICH ALGO IS RUNNING
  // --------------------------------
  getClientUid() {
    const uid = this.clientUid;
    console.log('Client UID requested:', uid); // 🔥 DEBUG
    return { AlgoId: this.clientUid };
  }

  // --------------------------------
  // SAFE EXECUTOR
  // --------------------------------

  private async safeSync(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.logger.error('Sync failed', err?.stack || err);
    }
  }

  // --------------------------------
  // SCHEDULER EVERY 2 SEC
  // --------------------------------

  @Cron('*/1 * * * * *')
  async autoSyncScheduler() {
    try {
      await this.queueSync(async () => {
        await this.safeSync(() => this.syncOrderBook());
        await this.safeSync(() => this.syncTradeBook());
        await this.safeSync(() => this.syncNetPositions());

        await this.safeSync(() => this.loadAllCachesFromDB());
      });
    } catch (err) {
      this.logger.error('Scheduler error', err?.stack || err);
    }
  }

  // --------------------------------
  // CACHE LOADER
  // --------------------------------

  async loadAllCachesFromDB() {
    try {
      this.orderCache = await this.orderRepo.find();
      this.tradeCache = await this.tradeRepo.find();
      this.netPositionCache = await this.netPositionRepo.find();
    } catch (err) {
      this.logger.error('Cache load failed', err?.stack || err);
    }
  }

  // --------------------------------
  // GETTERS for local cache (fast access for strategies)
  // --------------------------------

  getOrders() {
    return this.orderCache;
  }

  getTrades() {
    return this.tradeCache;
  }

  getNetPositions() {
    return this.netPositionCache;
  }

  // --------------------------------
  // SYNC METHODS
  // --------------------------------

  private async syncOrderBook() {
    const data = await this.ordersService.getOrderBook();
    const trades = data?.trades ?? [];

    await this.syncCollection(this.orderRepo, trades);
  }

  private async syncTradeBook() {
    const data = await this.ordersService.getTradeBook();
    const trades = data?.trades ?? [];

    await this.syncCollection(this.tradeRepo, trades);
  }

  private async syncNetPositions() {
    const response = await this.ordersService.getNetPositions();
    const positions = response?.data ?? [];

    await this.netPositionRepo.deleteMany({});

    if (!positions.length) return;

    await this.netPositionRepo.insertMany(
      positions.map((pos) => ({
        token: pos.token,
        tsym: pos.tsym,
        raw: pos,
      })),
    );
  }

  private async syncCollection(repo: MongoRepository<any>, trades: any[]) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // cleanup old data
      await repo.deleteMany({
        tradeDate: { $ne: today } as any,
      });

      // ⭐ IMPORTANT FIX
      if (!Array.isArray(trades) || trades.length === 0) {
        this.logger.debug('No trades received. Skipping bulkWrite.');
        return;
      }

      const operations = trades.map((trade) => ({
        updateOne: {
          filter: {
            norenordno: trade.norenordno,
            exchordid: trade.exchordid,
          },
          update: {
            $set: {
              norenordno: trade.norenordno,
              exchordid: trade.exchordid,
              tradeDate: today,
              raw: trade,
            },
          },
          upsert: true,
        },
      }));

      // extra safety
      if (!operations.length) {
        this.logger.debug('Bulk operations empty. Skipping.');
        return;
      }

      await repo.bulkWrite(operations);
    } catch (err) {
      this.logger.error('syncCollection failed', err?.stack || err);
    }
  }

  // --------------------------------
  // PUBLIC FORCE SYNC (Websocket trigger)
  // --------------------------------

  async forceSyncFromWebsocket() {
    try {
      if (Date.now() - this.lastForceSync < 500) return; // throttle

      this.lastForceSync = Date.now(); // added data to throttle websocket triggered sync

      this.logger.log('Websocket triggered exchange sync');

      await this.queueSync(async () => {
        await this.safeSync(() => this.syncOrderBook());

        await this.safeSync(() => this.syncTradeBook());

        await this.safeSync(() => this.syncNetPositions());

        await this.safeSync(() => this.loadAllCachesFromDB());
      });

      const orders = this.getOrders();
      const trades = this.getTrades();
      const netPositions = this.getNetPositions();

      this.logger.log(
        `Sync complete. Orders: ${orders.length}, Trades: ${trades.length}, NetPositions: ${netPositions.length}`,
      );
    } catch (err) {
      this.logger.error('forceSyncFromWebsocket failed', err?.stack || err);
    }
  }

  //---------------------------------
  //  filter fucntions for getting order , trade and net position based on magic number
  // --------------------------------

  //Filtered Orders (using MAGIC_NUMBER + regex)
  getFilteredOrders() {
    const filtered = this.filterByMagicNumber(this.orderCache);

    this.logger.debug(
      `Filtered Orders: ${filtered.length} / ${this.orderCache.length}`,
    );

    return filtered;
  }

  //Filtered Trades (using MAGIC_NUMBER + regex)
  getFilteredTrades() {
    const filtered = this.filterByMagicNumber(this.tradeCache);

    this.logger.debug(
      `Filtered Trades: ${filtered.length} / ${this.tradeCache.length}`,
    );

    return filtered;
  }

  //Create Generic Filter Function
  private filterByMagicNumber(data: any[]) {
    if (!data?.length) return [];

    const MAGIC_NUMBER = this.MAGIC_NUMBER;

    const escapedMagic = MAGIC_NUMBER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // STRICT match: _21042026_
    const regex = new RegExp(`_${escapedMagic}_`);

    return data.filter((item) => {
      const remarks = item?.raw?.remarks || item?.remarks || '';

      if (!remarks) return false;

      const match = regex.test(remarks);

      // 🔥 DEBUG (TEMP ADD THIS)
      if (match) {
        // this.logger.warn(`✅ MATCHED MAGIC: ${remarks}`);
      } else {
        // this.logger.debug(`❌ SKIPPED: ${remarks}`);
      }

      return match;
    });
  }

  // making filtered net positions based on filtered orders and trades (advanced step, can be done later) artificially
  getFilteredNetPositions() {
    const trades = this.getFilteredTrades();
    const existingPositions = this.getNetPositions();

    if (!trades.length) {
      return {
        success: true,
        data: [],
      };
    }

    // -----------------------------
    // STEP 1: BUILD CALCULATED MAP
    // -----------------------------
    const calcMap = new Map<string, any>();

    for (const t of trades) {
      const raw = t.raw || t;

      const token = raw.token;
      const tsym = raw.tsym;
      const key = `${token}_${tsym}`;

      const qty = Number(raw.qty || 0);
      const price = Number(raw.avgprc || raw.prc || 0);
      const side = raw.trantype;

      if (!calcMap.has(key)) {
        calcMap.set(key, {
          token,
          tsym,
          daybuyqty: 0,
          daysellqty: 0,
          daybuyamt: 0,
          daysellamt: 0,
        });
      }

      const pos = calcMap.get(key);

      if (side === 'B') {
        pos.daybuyqty += qty;
        pos.daybuyamt += qty * price;
      } else if (side === 'S') {
        pos.daysellqty += qty;
        pos.daysellamt += qty * price;
      }
    }

    // -----------------------------
    // STEP 2: MAP EXISTING POSITIONS
    // -----------------------------
    const existingMap = new Map(
      existingPositions.map((p) => [`${p.token}_${p.tsym}`, p.raw]),
    );

    // -----------------------------
    // STEP 3: BUILD FINAL DATA
    // -----------------------------
    const data: any[] = [];

    for (const [key, calc] of calcMap.entries()) {
      const base = existingMap.get(key) || {};

      const daybuyavgprc = calc.daybuyqty ? calc.daybuyamt / calc.daybuyqty : 0;

      const daysellavgprc = calc.daysellqty
        ? calc.daysellamt / calc.daysellqty
        : 0;

      const netqty = calc.daybuyqty - calc.daysellqty;

      let netavgprc = 0;
      if (netqty > 0) netavgprc = daybuyavgprc;
      else if (netqty < 0) netavgprc = daysellavgprc;

      const rpnl = calc.daysellamt - calc.daybuyamt;

      data.push({
        ...base, // 🔥 keep ALL original exchange fields

        // 🔥 override calculated fields
        daybuyqty: calc.daybuyqty.toString(),
        daysellqty: calc.daysellqty.toString(),

        daybuyamt: calc.daybuyamt.toFixed(2),
        daybuyavgprc: daybuyavgprc.toFixed(2),

        daysellamt: calc.daysellamt.toFixed(2),
        daysellavgprc: daysellavgprc.toFixed(2),

        netqty: netqty.toString(),
        netavgprc: netavgprc.toFixed(2),

        totbuyamt: calc.daybuyamt.toFixed(2),
        totsellamt: calc.daysellamt.toFixed(2),

        totbuyavgprc: daybuyavgprc.toFixed(2),
        totsellavgprc: daysellavgprc.toFixed(2),

        rpnl: rpnl.toFixed(2),
      });
    }

    this.logger.debug(`Filtered Positions (Final API): ${data.length}`);

    return {
      success: true,
      data,
    };
  }
  // old working perfect
  // getFilteredNetPositions() {
  //   const trades = this.getFilteredTrades();
  //   const existingPositions = this.getNetPositions();

  //   if (!trades.length) return [];

  //   // -----------------------------
  //   // STEP 1: BUILD CALCULATED MAP
  //   // -----------------------------
  //   const calcMap = new Map<string, any>();

  //   for (const t of trades) {
  //     const raw = t.raw || t;

  //     const token = raw.token;
  //     const tsym = raw.tsym;
  //     const key = `${token}_${tsym}`;

  //     const qty = Number(raw.qty || 0);
  //     const price = Number(raw.avgprc || raw.prc || 0);
  //     const side = raw.trantype;

  //     if (!calcMap.has(key)) {
  //       calcMap.set(key, {
  //         token,
  //         tsym,
  //         daybuyqty: 0,
  //         daysellqty: 0,
  //         daybuyamt: 0,
  //         daysellamt: 0,
  //       });
  //     }

  //     const pos = calcMap.get(key);

  //     if (side === 'B') {
  //       pos.daybuyqty += qty;
  //       pos.daybuyamt += qty * price;
  //     } else if (side === 'S') {
  //       pos.daysellqty += qty;
  //       pos.daysellamt += qty * price;
  //     }
  //   }

  //   // -----------------------------
  //   // STEP 2: CREATE RESULT
  //   // -----------------------------
  //   const result: any[] = [];

  //   for (const [key, calc] of calcMap.entries()) {
  //     const existing = existingPositions.find(
  //       (p) => p.token === calc.token && p.tsym === calc.tsym,
  //     );

  //     // fallback if not found
  //     const base = existing?.raw || {};

  //     const daybuyavgprc = calc.daybuyqty ? calc.daybuyamt / calc.daybuyqty : 0;

  //     const daysellavgprc = calc.daysellqty
  //       ? calc.daysellamt / calc.daysellqty
  //       : 0;

  //     const netqty = calc.daybuyqty - calc.daysellqty;

  //     let netavgprc = 0;
  //     if (netqty > 0) netavgprc = daybuyavgprc;
  //     else if (netqty < 0) netavgprc = daysellavgprc;

  //     const rpnl = calc.daysellamt - calc.daybuyamt;

  //     // -----------------------------
  //     // STEP 3: MERGE DATA
  //     // -----------------------------
  //     result.push({
  //       token: calc.token,
  //       tsym: calc.tsym,
  //       raw: {
  //         ...base, // 🔥 keep all exchange fields

  //         // 🔥 override ONLY calculated fields
  //         daybuyqty: calc.daybuyqty.toString(),
  //         daysellqty: calc.daysellqty.toString(),

  //         daybuyamt: calc.daybuyamt.toFixed(2),
  //         daybuyavgprc: daybuyavgprc.toFixed(2),

  //         daysellamt: calc.daysellamt.toFixed(2),
  //         daysellavgprc: daysellavgprc.toFixed(2),

  //         netqty: netqty.toString(),
  //         netavgprc: netavgprc.toFixed(2),

  //         totbuyamt: calc.daybuyamt.toFixed(2),
  //         totsellamt: calc.daysellamt.toFixed(2),

  //         totbuyavgprc: daybuyavgprc.toFixed(2),
  //         totsellavgprc: daysellavgprc.toFixed(2),

  //         rpnl: rpnl.toFixed(2),
  //       },
  //     });
  //   }

  //   this.logger.debug(`Filtered Positions (Merged): ${result.length}`);

  //   return result;
  // }
}
