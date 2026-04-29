import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { OrdersService } from 'src/orders/orders.service';
import { NormalizedTick } from './stoploss-target.types';
import { ConfigService } from '@nestjs/config';
import { TargetManager } from './target/target.manager';
import { isTradingAllowedForExchange } from 'src/common/utils/trading-time.util';
import { ExchangeDataService } from '@/strategy/exchange-data/exchange-data.service';

//--------------------------------
//Flow in one line:
//👉 Tick → Validate → Find Position → Place SL → Sync → Trail → Manage Target → Cleanup
/*  flow in detail:
Tick →
Check local memory →
Check cache →
Place order →
Update memory →
Force sync →
Cache updated

 memory cleaning process ===
 Tick →
  Local memory check (2s)
  Exchange cache (fresh ≤1s)
  Track check
→ Place once
→ Memory set immediately
→ Force sync
→ Cache updated

*/

//-------------------------------

interface CachedBlock<T> {
  data: T;
  updatedAt: number;
}

interface PositionLifecycleState {
  observedSide: 'BUY' | 'SELL';
  observedQty: number;
  observedAt: number;

  confirmedSide?: 'BUY' | 'SELL';
  confirmedQty?: number;
}

@Injectable()
export class StoplossTargetService implements OnModuleInit {
  private readonly logger = new Logger(StoplossTargetService.name);
  private refreshLock = false; // to prevent overlapping refreshes

  private lastSLCancelTime = new Map<string, number>();
  private slPlacedTime = new Map<string, number>(); // ✅ ADD

  private localOrderMemory = new Map<string, number>(); // to add a cooling period
  private globalSLLock = new Set<string>(); // global lock for reducing duplicate SL placement in quick
  // succession

  /*
  Tick →
No Position →
Cancel SL/Target →
Clear memory →
🔥 Run cleanup ONCE per day →
Exit
  */
  private lastCleanupDate: string | null = null; // clean once a day
  private inFlightSL = new Set<string>(); // same target type inflight lock

  // adding target logic file properties
  private targetManager!: TargetManager;

  private readonly SL_LIMIT_PCT = Number(
    process.env.SL_LIMIT_PRICE_PCT || 0.01,
  );

  // ===============================
  // 🔒 RUNTIME CACHES
  // ===============================
  private netPositions!: CachedBlock<any[]>;
  private orderBook!: CachedBlock<any[]>;
  private tradeBook!: CachedBlock<any[]>;

  // ===============================
  // 🧠 POSITION LIFECYCLE STATE
  // ===============================
  private positionState = new Map<string, PositionLifecycleState>();

  // private slPlacementLock = new Set<string>();
  private slPlacedMap = new Map<string, string>();
  // token -> orderId

  // ===============================
  // 📦 INSTRUMENT MASTER
  // ===============================
  private instruments: any[] = [];

  // ===============================
  // ⚙️ CONFIG
  // ===============================
  private readonly DATA_TTL_MS = 1000;

  // private readonly SL_PERCENT = Number(
  //   process.env.STANDARD_STOPLOSS_PERCENT || 0.25,
  // );
  // private readonly FIRST_PROFIT_STAGE = Number(
  //   process.env.FIRST_PROFIT_STAGE || 0.66,
  // );

  private readonly TRACK_DIR = path.join(
    process.cwd(),
    'data/TVstopossTargetTrack',
  );

  constructor(
    private readonly ordersService: OrdersService,
    private readonly ConfigService: ConfigService,
    private readonly exchangeDataService: ExchangeDataService, // ✅ ADD
  ) {}

  // =====================================================
  // 🚀 INIT
  // =====================================================
  async onModuleInit() {
    try {
      this.loadInstruments();
      await this.refreshAllTradingData();
      this.logger.log('✅ StoplossTargetService initialized');
    } catch (e) {
      this.logger.error(
        '⚠️ StoplossTargetService started with partial failure',
        e?.message,
      );
    }

    // this.logger.log(
    //   `📊 SL config | SL_PERCENT=${this.SL_PERCENT} | FIRST_PROFIT_STAGE=${this.FIRST_PROFIT_STAGE}`,
    // );
    this.logger.log(`📊 Dynamic SL config enabled (OPTIDX / FUTIDX mode)`);

    // initializing target manager
    this.targetManager = new TargetManager(
      this.ordersService,
      this.ConfigService,
      this.exchangeDataService, // 🔥 ADD THIS
    );
    this.logger.log('✅ 🎯 TargetManager initialized');
  }
  //defining getters for config values
  private get SL_PERCENT(): number {
    const raw = this.ConfigService.get<string>(
      'STANDARD_STOPLOSS_PERCENT',
      '0.25',
    );

    const value = Number(raw);

    if (Number.isNaN(value)) {
      throw new Error(`Invalid STANDARD_STOPLOSS_PERCENT value: ${raw}`);
    }

    // allow 25 or 0.25
    return value > 1 ? value / 100 : value;
  }

  // added getter for enable disable target and stoploss from env
  private get IS_SL_ENABLED(): boolean {
    return this.ConfigService.get<string>('ENABLE_STOPLOSS', 'true') === 'true';
  }

  private get IS_TARGET_ENABLED(): boolean {
    return this.ConfigService.get<string>('ENABLE_TARGET', 'true') === 'true';
  }

  private get FIRST_PROFIT_STAGE(): number {
    const raw = this.ConfigService.get<string>('FIRST_PROFIT_STAGE', '0.66');

    const value = Number(raw);

    if (Number.isNaN(value)) {
      throw new Error(`Invalid FIRST_PROFIT_STAGE value: ${raw}`);
    }

    // allow 66 or 0.66
    return value > 1 ? value / 100 : value;
  }

  // =====================================================
  // ⏱️ DATA REFRESH
  // =====================================================
  @Interval(1000)
  async refreshAllTradingData() {
    // 🔒 prevent overlapping executions
    if (this.refreshLock) {
      this.logger.debug(
        '⏳ refreshAllTradingData skipped (previous still running)',
      );
      return;
    }

    this.refreshLock = true;

    try {
      // ❗ SERIAL execution (NOT Promise.all)
      await this.refreshNetPositions();
      await this.refreshOrderBook();
      await this.refreshTradeBook();
    } catch (err) {
      this.logger.error('❌ refreshAllTradingData failed', err?.message || err);
    } finally {
      this.refreshLock = false;
    }
  }

  // private async refreshNetPositions() {
  //   const res = await this.ordersService.getNetPositions();
  //   if (Array.isArray(res?.data)) {
  //     this.netPositions = { data: res.data, updatedAt: Date.now() };
  //   }
  // }

  // private async refreshOrderBook() {
  //   const res = await this.ordersService.getOrderBook();
  //   if (Array.isArray(res?.trades)) {
  //     this.orderBook = { data: res.trades, updatedAt: Date.now() };
  //   }
  // }

  // private async refreshTradeBook() {
  //   const res = await this.ordersService.getTradeBook();
  //   if (Array.isArray(res?.trades)) {
  //     this.tradeBook = { data: res.trades, updatedAt: Date.now() };
  //   }
  // }
  // =====================================================
  // 📥 ADDING FILTERED EXCHANGE DATA WITH MAGIC NUMBER
  // =====================================================

  private async refreshNetPositions() {
    const res = this.exchangeDataService.getFilteredNetPositions();

    if (Array.isArray(res?.data)) {
      this.netPositions = { data: res.data, updatedAt: Date.now() };
    }
  }

  private async refreshOrderBook() {
    const orders = this.exchangeDataService.getFilteredOrders();

    if (Array.isArray(orders)) {
      this.orderBook = { data: orders, updatedAt: Date.now() };
    }
  }

  private async refreshTradeBook() {
    const trades = this.exchangeDataService.getFilteredTrades();

    if (Array.isArray(trades)) {
      this.tradeBook = { data: trades, updatedAt: Date.now() };
      await this.handleTradeBasedSLUpdate(trades); // NEW: handle SL updates based on trades
    }
  }

  // =====================================================
  // 📥 INSTRUMENTS
  // =====================================================
  private loadInstruments() {
    this.instruments = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'data/instrumentinfo/instruments.json'),
        'utf8',
      ),
    );
  }

  // =====================================================
  // 📡 ENTRY FROM WEBSOCKET
  // =====================================================
  async onTick(rawTick: any) {
    // this.logger.log(` current sl percent value : ${this.SL_PERCENT}`);
    // this.logger.log(
    //   ` current first profit stage value : ${this.FIRST_PROFIT_STAGE}`,
    // );
    const tick = this.normalizeTick(rawTick);
    if (!tick) return;
    if (!this.isCacheFresh()) {
      this.logger.warn('⚠️ Cache stale — allowing risk sync anyway');
    }

    // this.logger.log(`Processing tick for token: ${tick.tk} : `, tick);

    const position = this.findMatchingOpenPosition(tick);
    const pendingSL = this.findPendingSL(tick);

    // ============================
    // CASE-A: POSITION CLOSED
    // ============================
    // if (!position && pendingSL) {
    //   await this.cancelPendingSL(pendingSL, 'NET_POSITION_CLOSED');
    //   return;
    // now closing both sl and pending target order if exists as position is closed
    if (!position) {
      // cancel SL if exists
      if (pendingSL) {
        await this.cancelPendingSL(pendingSL, 'NET_POSITION_CLOSED');
      }

      // ✅ CLEAR STATE
      // this.slPlacedMap.delete(tick.tk);
      // delete target json file also
      await this.clearTargetTrack(tick.tk);

      // 🔥 NEW: cancel target orders
      await this.cancelPendingTargetOrders(tick);
      // 🔥 ADD THIS (MOST IMPORTANT)
      await this.clearAllStateForToken(tick.tk);
      // 🔥 ADD THIS (MOST IMPORTANT)
      await this.clearAllSLTrackFilesIfNoPositions();
      // 🔥 ADD THIS for cleaning fucntion
      this.runDailyCleanupOnce();

      return;
    }

    if (!position) return;

    // ============================
    // Time Restriction Check
    // ============================

    // this.logger.log(` Checking trading time for positions : `, position);
    const exchange = position.exch;
    // this.logger.log(` Checking trading time for exchange : ${exchange} `);

    if (!isTradingAllowedForExchange(exchange, this.ConfigService)) {
      this.logger.warn(
        `⏰ Trading time restricted. Skipping Action on SL-TRAIL / TARGET Findings for ${exchange}|${exchange.token}|${exchange.symbol}`,
      );
      return;
    }

    // const side: 'BUY' | 'SELL' = Number(position.netqty) > 0 ? 'BUY' : 'SELL';
    // const qty = Math.abs(Number(position.netqty));
    const qty = Math.abs(Number(position.netqty ?? position.raw?.netqty ?? 0));

    // ============================
    // 🔥 STABILITY + FLIP CHECK
    // ============================
    const positionSideFromQty: 'BUY' | 'SELL' =
      Number(position.netqty) > 0 ? 'BUY' : 'SELL';
    const posCheck = this.checkPositionStabilityAndFlip(
      tick.tk,
      positionSideFromQty,
      qty,
    );

    // if (!posCheck.stable) return;
    if (!posCheck.stable) {
      this.logger.debug(`⏳ Position not stable yet for ${tick.tk}`);
      // ❌ DO NOT return
    }

    if (pendingSL && posCheck.flipped) {
      await this.cancelPendingSL(pendingSL, 'POSITION_FLIPPED_REVERSE_SIDE');
      // 🔥 ADD THIS
      await this.cancelPendingTargetOrders(tick);
      // 🔥 CLEAR TARGET TRACK ON FLIP
      await this.clearTargetTrack(tick.tk); //

      // return; // fresh SL on next tick
      this.targetManager.clearLocalTargetMemory(tick.tk); // resting local target memory
      // go ahead and place fresh sl
      this.lastSLCancelTime.delete(tick.tk); // 🔥 VERY IMPORTANT
      this.slPlacedTime.delete(tick.tk); // 🔥 VERY IMPORTANT
    }

    const instrument = this.findInstrument(tick);
    if (!instrument) return;
    const cfg = this.getConfigForPosition(position); // geting config data of matching positions for target booking

    // start processing code once tick is recived

    // await this.processRisk({
    //   tick,
    //   position,
    //   instrument,
    //   pendingSL,
    //   config: cfg, // ✅ ADD
    // });
    if (!this.IS_SL_ENABLED)
      this.logger.debug(
        `⏩ SL processing disabled, skipping to target management for ${tick.tk}`,
      );
    if (this.IS_SL_ENABLED) {
      await this.processRisk({
        tick,
        position,
        instrument,
        pendingSL,
        config: cfg,
      });
    }
    // ============================
    // 🔥 TARGET ACQUIREMENT LOGIC
    // ============================
    // await this.targetManager.checkAndProcessTarget({
    //   tick,
    //   netPosition: position,
    //   tradeBook: this.tradeBook.data,
    //   instrument,
    //   config: cfg, // important to pass config data of target price
    // });
    if (!this.IS_TARGET_ENABLED)
      this.logger.debug(`⏩ Target processing disabled for ${tick.tk}`);
    if (this.IS_TARGET_ENABLED) {
      await this.targetManager.checkAndProcessTarget({
        tick,
        netPosition: position,
        tradeBook: this.tradeBook.data,
        instrument,
        config: cfg,
      });
    }
  }

  // =====================================================
  // 🧠 CORE LOGIC — STEP-2
  // =====================================================
  private async processRisk({
    tick,
    position,
    instrument,
    pendingSL,
    config,
  }: {
    tick: NormalizedTick;
    position: any;
    instrument: any;
    pendingSL: any | null;
    config: {
      slPercent: number;
      firstProfit: number;
      breakeven: number;
      targetFirst: number;
    };
  }) {
    const SL_PERCENT = config.slPercent;
    const FIRST_PROFIT_STAGE = config.firstProfit;

    // START ON TICK
    const ltp = tick.lp;
    // const side: 'BUY' | 'SELL' = Number(position.netqty) > 0 ? 'BUY' : 'SELL';
    const side: 'BUY' | 'SELL' =
      Number(position.netqty ?? position.raw?.netqty) > 0 ? 'BUY' : 'SELL';
    const qty = Math.abs(Number(position.netqty));

    // const positionSide: 'BUY' | 'SELL' =
    //   Number(position.netqty) > 0 ? 'BUY' : 'SELL';
    let positionSide: 'BUY' | 'SELL';

    // const netQty = Number(position.netqty);
    const netQty = Number(position.netqty ?? position.raw?.netqty ?? 0);

    if (netQty !== 0) {
      positionSide = netQty > 0 ? 'BUY' : 'SELL';
    } else {
      // 🔥 fallback to latest trade (CRITICAL FIX)
      const latestTrade = this.tradeBook.data
        .filter((t) => {
          const raw = t.raw || t;

          return (
            raw.token === tick.tk &&
            !(raw.remarks || '').includes('TARGET') && // ✅ ADD
            !(raw.remarks || '').includes('SL') // ✅ ADD
          );
        })
        .sort(
          (a, b) =>
            new Date(b.raw?.exch_tm || b.exch_tm).getTime() -
            new Date(a.raw?.exch_tm || a.exch_tm).getTime(),
        )[0];

      positionSide = latestTrade?.raw?.trantype === 'B' ? 'BUY' : 'SELL';
    }

    const slOrderSide: 'BUY' | 'SELL' = positionSide === 'BUY' ? 'SELL' : 'BUY';

    // const positionSide: 'BUY' | 'SELL' =
    //   Number(position.netqty) > 0 ? 'BUY' : 'SELL';

    // const latestTrade = this.tradeBook.data
    //   .filter((t) => (t.raw?.token || t.token) === tick.tk)
    //   .sort((a, b) => {
    //     const t1 = new Date(a.raw?.exch_tm || a.exch_tm).getTime();
    //     const t2 = new Date(b.raw?.exch_tm || b.exch_tm).getTime();
    //     return t2 - t1;
    //   })[0];

    // const positionSide: 'BUY' | 'SELL' =
    //   latestTrade?.raw?.trantype === 'B' ? 'BUY' : 'SELL';

    // =====================================================
    // STEP-2 — INITIAL SL
    // =====================================================
    // if (!pendingSL) {
    //   if (this.slPlacementLock.has(tick.tk)) return;
    //   this.slPlacementLock.add(tick.tk);
    // const existingSL = this.slPlacedMap.get(tick.tk);

    // if (existingSL && !pendingSL) {
    //   this.slPlacedMap.delete(tick.tk);
    // }

    // ❌ DO NOT clear SL based on cache (cache is delayed)
    // trust slPlacedMap instead

    const latestOrders = this.exchangeDataService.getFilteredOrders();
    const anySLExists = latestOrders.some((o) => {
      const raw = o.raw || o;

      return (
        raw.token === tick.tk &&
        raw.exch === tick.e &&
        raw.prctyp === 'SL-LMT' &&
        raw.status !== 'CANCELED' && // ✅ ADD THIS
        ['TRIGGER_PENDING', 'OPEN'].includes(raw.status)
      );
    });
    // const anySLExists = this.orderBook.data.some((o) => {
    //   const raw = o.raw || o;

    //   return (
    //     // raw.token === tick.tk && raw.exch === tick.e && raw.prctyp === 'SL-LMT'
    //     raw.token === tick.tk &&
    //     raw.exch === tick.e &&
    //     raw.prctyp === 'SL-LMT' &&
    //     ['TRIGGER_PENDING', 'OPEN'].includes(raw.status)
    //   );
    // });

    const existingSL = this.slPlacedMap.get(tick.tk); // get data from map also

    // 🔥 ADD THIS DEBUG LOG HERE
    this.logger.warn(`
    SL PLACEMENT CHECK:
    token=${tick.tk}
    pendingSL=${!!pendingSL}
    existingSL=${!!existingSL}
    anySLExists=${!!anySLExists}
    `);

    if (
      !pendingSL &&
      !existingSL
      // && !anySLExists
    ) // if (!pendingSL && !anySLExists)
    {
      // if (!pendingSL && !anySLExists) {
      try {
        // 🔥 ALWAYS USE MARKET PRICE SCALE
        const entryPrice = ltp; // tick.lp is true traded price
        const openPrice = Number(position.netavgprc);

        // ✅ ALWAYS USE NET POSITION FOR SL

        const rawTrigger =
          positionSide === 'BUY'
            ? entryPrice * (1 - SL_PERCENT)
            : entryPrice * (1 + SL_PERCENT);

        const trigger = this.normalizeTriggerPrice(
          rawTrigger,
          instrument,
          positionSide,
        );

        const limitPrice = this.calculateSLLimitPrice(
          trigger,
          slOrderSide,
          instrument,
        );

        this.logger.log(
          `DEBUG SL | open=${entryPrice} | SL_PERCENT=${SL_PERCENT} | limit price =${limitPrice}| calculated trigger=${trigger}`,
        );

        // placing for placing sl order
        const lastCancel = this.lastSLCancelTime.get(tick.tk);

        if (lastCancel && Date.now() - lastCancel < 2000) {
          this.logger.warn(`⏳ Skipping SL re-entry (cooldown) | ${tick.tk}`);
          return;
        }
        // check added
        // just putting delay for loopin sl placement
        const lastPlaced = this.slPlacedTime.get(tick.tk);

        if (lastPlaced && Date.now() - lastPlaced < 3000) {
          this.logger.warn(`⏳ Skipping duplicate SL (cooldown) | ${tick.tk}`);
          return;
        }
        // check added
        const lastLocal = this.localOrderMemory.get(`SL_${tick.tk}`);

        if (lastLocal && Date.now() - lastLocal < 3000) {
          this.logger.warn(`⏳ LOCAL BLOCK SL | ${tick.tk}`);
          return;
        }

        this.logger.warn(
          `SL DEBUG → trigger=${trigger}, limit=${limitPrice}, side=${slOrderSide}`,
        );

        // inflight check updated
        if (this.inFlightSL.has(tick.tk)) {
          this.logger.warn(`⛔ IN-FLIGHT BLOCK SL | ${tick.tk}`);
          return;
        }

        this.inFlightSL.add(tick.tk);
        // updated data of tick token in inflight
        // ADDING GLOBAL LOCK TO REDUCE DUPLICATE SL PLACEMENT IN CASE OF QUICK SUCCESSION OF TICKS BEFORE CACHE UPDATE
        if (this.globalSLLock.has(tick.tk)) {
          this.logger.warn(`⛔ GLOBAL LOCK SL | ${tick.tk}`);
          return;
        }

        this.globalSLLock.add(tick.tk);

        // 🔥 FINAL SAFETY CHECK (MOST IMPORTANT)
        const latestOrders = this.exchangeDataService.getFilteredOrders();

        const slExistsNow = latestOrders.find((o) => {
          const raw = o.raw || o;

          return (
            raw.token === tick.tk &&
            raw.exch === tick.e &&
            raw.prctyp === 'SL-LMT' &&
            raw.status !== 'CANCELED' && // ✅ ADD THIS
            ['OPEN', 'TRIGGER_PENDING'].includes(raw.status)
          );
        });

        if (slExistsNow) {
          this.logger.warn(`⛔ FINAL BLOCK SL (post-check) | ${tick.tk}`);
          return;
        }

        // ⛔ DO NOT remove immediately
        setTimeout(() => {
          this.globalSLLock.delete(tick.tk);
          this.logger.warn(`🔓 GLOBAL LOCK RELEASED SL | ${tick.tk}`);
        }, 2000);
        // GLOBAL LOCK ADDED WITH 4 SEC DELAY

        const justPlacedKey = `SL_JUST_${tick.tk}`;

        if (this.localOrderMemory.has(justPlacedKey)) {
          this.logger.warn(`⛔ JUST PLACED BLOCK SL | ${tick.tk}`);
          return;
        }
        // UPDATED CHECK FOR JUST PLACED SL TO PREVENT DUPLICATE PLACEMENT IN SAME TICK OR BEFORE CACHE UPDATE

        // 🔥 MOVE MEMORY SET BEFORE API CALL (CRITICAL FIX)
        this.localOrderMemory.set(`SL_${tick.tk}`, Date.now());
        this.slPlacedTime.set(tick.tk, Date.now());
        // updated with current time to prevent duplicate SL placement in quick succession before cache update

        // check log
        this.logger.error(`SL FINAL CHECK:
        positionSide=${positionSide}
        slOrderSide=${slOrderSide}
        trigger=${trigger}
        limit=${limitPrice}
        `);

        const res = await this.ordersService.placeOrder({
          // buy_or_sell: side === 'BUY' ? 'S' : 'B',
          buy_or_sell: slOrderSide === 'BUY' ? 'B' : 'S',
          product_type: position.prd,
          exchange: tick.e,
          tradingsymbol: instrument.tradingSymbol,
          quantity: qty,
          price_type: 'SL-LMT', // ✅ CHANGED
          price: limitPrice, // ✅ REQUIRED
          trigger_price: trigger, // ✅ REQUIRED
          retention: 'DAY',
          amo: 'NO',
          remarks: 'AUTO_INITIAL_SL',
        });

        // await this.exchangeDataService.forceSyncFromWebsocket(); //FORCE SYNC AFTER ORDER

        const orderId = this.extractOrderNo(res);
        if (!orderId) return;

        // ✅ STORE SL STATE
        // ✅ ADD THIS BACK
        this.slPlacedMap.set(tick.tk, orderId);

        const standardDiff = entryPrice * SL_PERCENT;

        this.appendOrderLog(orderId, {
          action: 'INITIAL_SL_PLACED',
          side,
          stage: 'STANDARD',

          trigger,
          openPrice,
          entryPrice,

          slPercentUsed: SL_PERCENT,
          slDiffUsed: standardDiff,

          highestPrice: side === 'BUY' ? entryPrice : undefined,
          lowestPrice: side === 'SELL' ? entryPrice : undefined,
          qty,
        });

        this.logger.log(`✅ Initial SL placed | ${tick.tk} | ${trigger}`);
        // 🔥 JUST PLACED LOCK (same as target) puttig delay
        this.localOrderMemory.set(justPlacedKey, Date.now());

        setTimeout(() => {
          this.localOrderMemory.delete(justPlacedKey);
        }, 5000);
      } finally {
        // setTimeout(() => this.slPlacementLock.delete(tick.tk), 1200);
        this.inFlightSL.delete(tick.tk); // 🔥 MUST reset
      }

      return;
    }

    // =====================================================
    // STEP-2.5 — SYNC SL QUANTITY WITH POSITION
    // =====================================================
    // if (pendingSL) {
    //   await this.syncStoplossQuantityWithPosition(
    //     tick,
    //     position,
    //     instrument,
    //     pendingSL,
    //   );
    // }
    // const anySLOrder = this.orderBook.data.find((o) => {
    //   const raw = o.raw || o;

    //   return (
    //     raw.token === tick.tk && raw.exch === tick.e && raw.prctyp === 'SL-LMT'
    //   );
    // });
    // const latestOrders = this.exchangeDataService.getFilteredOrders();

    const anySLOrder = latestOrders.find((o) => {
      const raw = o.raw || o;

      return (
        raw.token === tick.tk &&
        raw.exch === tick.e &&
        raw.prctyp === 'SL-LMT' &&
        raw.status !== 'CANCELED' // ✅ ADD THIS
      );
    });

    // const slToSync = pendingSL || anySLOrder;
    const existingSLId = this.slPlacedMap.get(tick.tk);

    const slToSync =
      pendingSL ||
      anySLOrder ||
      (existingSLId ? { norenordno: existingSLId } : null);

    if (slToSync) {
      await this.exchangeDataService.forceSyncFromWebsocket(); // just refresh data before syncing quantity to get latest order book state
      await this.syncStoplossQuantityWithPosition(
        tick,
        position,
        instrument,
        slToSync,
      );
    }

    // =====================================================
    // STEP-3 + STEP-4 — TRAILING WITH FIRST PROFIT STAGE
    // =====================================================
    // const orderId = this.extractOrderNo(pendingSL.orderno || pendingSL);
    // if (!pendingSL) return;

    // const orderId = this.extractOrderNo(pendingSL?.orderno || pendingSL);
    const slOrderForTrail = pendingSL || anySLOrder;
    const orderId = this.extractOrderNo(
      slOrderForTrail?.orderno || slOrderForTrail,
    );

    if (!orderId) return;

    const track = this.readOrderTrack(orderId);
    if (!track.length) return;

    const state = this.deriveTrailingState(track);
    if (!state) return;

    const { openPrice, currentSL, highestPrice, lowestPrice, stage } = state;

    const standardDiff = openPrice * SL_PERCENT;
    const firstProfitDiff = standardDiff * FIRST_PROFIT_STAGE;

    let activeDiff = standardDiff;
    let nextStage: 'STANDARD' | 'FIRST_PROFIT' | null = null;

    // =====================================================
    // FIRST PROFIT STAGE CHECK (ONE TIME)
    // =====================================================
    if (
      stage === 'STANDARD' &&
      ((side === 'BUY' && ltp >= openPrice + firstProfitDiff) ||
        (side === 'SELL' && ltp <= openPrice - firstProfitDiff))
    ) {
      activeDiff = firstProfitDiff;
      nextStage = 'FIRST_PROFIT';
    }

    if (stage === 'FIRST_PROFIT') {
      activeDiff = firstProfitDiff;
    }

    let newExtreme: number;
    let newSL: number;

    if (side === 'BUY') {
      newExtreme = Math.max(highestPrice ?? openPrice, ltp);
      if (newExtreme <= (highestPrice ?? openPrice)) return;

      newSL = newExtreme - activeDiff;
      if (newSL <= currentSL) return;
    } else {
      newExtreme = Math.min(lowestPrice ?? openPrice, ltp);
      if (newExtreme >= (lowestPrice ?? openPrice)) return;

      newSL = newExtreme + activeDiff;
      if (newSL >= currentSL) return;
    }

    // =====================================================
    // MODIFY SL
    // =====================================================
    const normalizedSL = this.normalizeTriggerPrice(newSL, instrument, side);

    await this.modifyStoploss(
      orderId,
      tick.e,
      instrument.tradingSymbol,
      qty,
      normalizedSL,
      slOrderSide, // ✅ REQUIRED
      instrument, // ✅ ADD
    );

    // =====================================================
    // JSON LOG (EVENT-BASED)
    // =====================================================
    const appliedStage = nextStage ?? stage;
    const slPercentUsed =
      appliedStage === 'FIRST_PROFIT'
        ? SL_PERCENT * FIRST_PROFIT_STAGE
        : SL_PERCENT;

    this.appendOrderLog(orderId, {
      action: 'SL_TRAILED',
      side,
      stage: appliedStage,

      previousSL: currentSL,
      newSL,

      slPercentUsed,
      slDiffUsed: activeDiff,

      highestPrice: side === 'BUY' ? newExtreme : undefined,
      lowestPrice: side === 'SELL' ? newExtreme : undefined,
    });

    this.logger.log(`📈 SL trailed | ${tick.tk} | ${currentSL} → ${newSL}`);
  }

  // =====================================================
  // 🔥 POSITION STABILITY + FLIP (CORE FIX)
  // =====================================================
  private checkPositionStabilityAndFlip(
    token: string,
    side: 'BUY' | 'SELL',
    qty: number,
    delayMs = 800,
  ): { stable: boolean; flipped: boolean } {
    const now = Date.now();
    const state = this.positionState.get(token);

    if (!state) {
      this.positionState.set(token, {
        observedSide: side,
        observedQty: qty,
        observedAt: now,
      });
      return { stable: false, flipped: false };
    }

    if (state.observedSide !== side || state.observedQty !== qty) {
      state.observedSide = side;
      state.observedQty = qty;
      state.observedAt = now;
      return { stable: false, flipped: false };
    }

    if (now - state.observedAt < delayMs) {
      return { stable: false, flipped: false };
    }

    const flipped =
      state.confirmedSide !== undefined && state.confirmedSide !== side;

    state.confirmedSide = side;
    state.confirmedQty = qty;

    return { stable: true, flipped };
  }

  // =====================================================
  // 🔎 HELPERS
  // =====================================================
  private normalizeTick(raw: any): NormalizedTick | null {
    const lp = Number(raw?.lp);
    if (!raw || !raw.tk || !raw.e || !Number.isFinite(lp) || lp <= 0)
      return null;
    return { tk: raw.tk, e: raw.e, lp };
  }

  private isCacheFresh(): boolean {
    const now = Date.now();
    return (
      now - this.netPositions?.updatedAt < this.DATA_TTL_MS &&
      now - this.orderBook?.updatedAt < this.DATA_TTL_MS &&
      now - this.tradeBook?.updatedAt < this.DATA_TTL_MS
    );
  }

  private findMatchingOpenPosition(tick: NormalizedTick) {
    // return this.netPositions.data.find(
    //   (p) => p.token === tick.tk && p.exch === tick.e && Number(p.netqty) !== 0,
    // );
    return this.netPositions.data.find(
      (p) =>
        (p.token || p.raw?.token) === tick.tk &&
        (p.exch || p.raw?.exch) === tick.e &&
        Number(p.netqty || p.raw?.netqty) !== 0,
    );
  }

  // private findPendingSL(tick: NormalizedTick) {
  //   // return this.orderBook.data.find(
  //   //   (o) =>
  //   //     o.token === tick.tk &&
  //   //     o.exch === tick.e &&
  //   //     o.prctyp === 'SL-LMT' &&
  //   //     o.status === 'TRIGGER_PENDING',
  //   // );
  //   return this.orderBook.data.find((o) => {
  //     const raw = o.raw || o;

  //     return (
  //       raw.token === tick.tk &&
  //       raw.exch === tick.e &&
  //       raw.prctyp === 'SL-LMT' &&
  //       ['TRIGGER_PENDING', 'OPEN'].includes(raw.status) // ✅ FIX
  //     );
  //   });
  // }

  private findPendingSL(tick: NormalizedTick) {
    return this.orderBook.data.find((o) => {
      const raw = o.raw || o;

      return (
        raw.token === tick.tk &&
        raw.exch === tick.e &&
        raw.prctyp === 'SL-LMT' &&
        // 🔥 DO NOT depend only on status
        (['TRIGGER_PENDING', 'OPEN'].includes(raw.status) ||
          raw.status === undefined) && // fallback (some feeds)
        raw.status !== 'CANCELED' // ✅ ADD THIS
      );
    });
  }

  private findInstrument(tick: NormalizedTick) {
    return this.instruments.find(
      (i) => i.exchange === tick.e && i.token === tick.tk,
    );
  }

  private extractOrderNo(o: any): string | null {
    if (!o) return null;
    if (typeof o === 'string') return o;
    if (o.norenordno) return o.norenordno;
    return null;
  }

  private async cancelPendingSL(
    order: any,
    reason: 'NET_POSITION_CLOSED' | 'POSITION_FLIPPED_REVERSE_SIDE',
  ) {
    const orderId = this.extractOrderNo(order.orderno || order);
    if (!orderId) return;

    await this.ordersService.cancelOrder(orderId);

    // ✅ IMPORTANT: remove from map
    // const token = order.token; // or pass tick.tk if safer
    const token = order?.raw?.token || order?.token;

    if (token) {
      this.slPlacedMap.delete(token);
    }
    // this.lastSLCancelTime.set(token, Date.now()); // adding to map for loop stop
    if (reason !== 'POSITION_FLIPPED_REVERSE_SIDE') {
      this.lastSLCancelTime.set(token, Date.now());
    }

    this.appendOrderLog(orderId, {
      action: 'SL_CANCELLED',
      reason,
    });

    this.logger.warn(`🛑 SL cancelled | ${orderId} | ${reason}`);
  }

  private appendOrderLog(orderId: string, payload: any) {
    if (!fs.existsSync(this.TRACK_DIR))
      fs.mkdirSync(this.TRACK_DIR, { recursive: true });

    const file = path.join(this.TRACK_DIR, `${orderId}.json`);
    const data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : [];

    data.push({ ...payload, time: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  // =====================================================
  // 🛠️ 3rd step mainking stoploss trails logic helper
  // =====================================================

  // 1️⃣ ADD THIS HELPER (READ TRACK FILE)
  private readOrderTrack(orderId: string): any[] {
    const file = path.join(this.TRACK_DIR, `${orderId}.json`);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  //2️⃣ ADD THIS HELPER (MODIFY SL)
  private async modifyStoploss(
    orderId: string,
    exchange: string,
    tradingSymbol: string,
    qty: number,
    trigger: number,
    slOrderSide: 'BUY' | 'SELL', // ✅ ADD THIS
    instrument: any, // ✅ ADD
  ) {
    // calculating limit price based on trigger and buffer pct
    const limitPrice = this.calculateSLLimitPrice(
      trigger,
      slOrderSide,
      instrument, // ✅ ADD
    );
    await this.ordersService.modifyOrder({
      orderno: orderId,
      exchange,
      tradingsymbol: tradingSymbol,
      quantity: qty,
      newprice_type: 'SL-LMT', // ✅ CHANGED
      newprice: limitPrice, // ✅ REQUIRED
      newtrigger_price: trigger, // ✅ REQUIRED
    });
  }

  // helper to add state derivation helper
  private deriveTrailingState(track: any[]): {
    openPrice: number;
    currentSL: number;
    highestPrice?: number;
    lowestPrice?: number;
    stage: 'STANDARD' | 'FIRST_PROFIT';
  } | null {
    let openPrice: number | undefined;
    let currentSL: number | undefined;
    let highestPrice: number | undefined;
    let lowestPrice: number | undefined;
    let stage: 'STANDARD' | 'FIRST_PROFIT' = 'STANDARD';

    for (const entry of track) {
      if (entry.openPrice && openPrice === undefined) {
        openPrice = entry.openPrice;
      }

      if (entry.trigger && currentSL === undefined) {
        currentSL = entry.trigger;
      }

      if (typeof entry.newSL === 'number') {
        currentSL = entry.newSL;
      }

      if (typeof entry.highestPrice === 'number') {
        highestPrice = entry.highestPrice;
      }

      if (typeof entry.lowestPrice === 'number') {
        lowestPrice = entry.lowestPrice;
      }

      if (entry.stage === 'FIRST_PROFIT') {
        stage = 'FIRST_PROFIT';
      }
    }

    if (openPrice === undefined || currentSL === undefined) {
      return null;
    }

    return { openPrice, currentSL, highestPrice, lowestPrice, stage };
  }

  // =====================================================
  // 🛠️ stoploss qunaitity sync logics and functions
  // =====================================================

  //HELPER: EXTRACT SL QTY & SIDE for managing missed qty cases
  private getSLOrderQty(order: any): number | null {
    if (!order) return null;
    const raw = order.raw || order;

    const qty = raw.qty ?? raw.quantity ?? raw.trdqty ?? raw.fillshares;

    return qty ? Math.abs(Number(qty)) : null;

    // const qty = order.qty ?? order.quantity ?? order.trdqty ?? order.fillshares;
    // return qty ? Math.abs(Number(qty)) : null;
  }
  private getSLTriggerPrice(order: any): number | null {
    return (
      Number(order.trigprc) ||
      Number(order.trigger_price) ||
      Number(order.trgprc) ||
      null
    );
  }

  //MAIN FUNCTION (CORE REQUIREMENT) TO SYNC SL QTY WITH POSITION QTY
  private async syncStoplossQuantityWithPosition(
    tick: NormalizedTick,
    position: any,
    instrument: any,
    pendingSL: any,
  ) {
    try {
      if (!position || !pendingSL) return;

      const netQty = Math.abs(Number(position.netqty));
      if (netQty <= 0) return;

      const slQty = this.getSLOrderQty(pendingSL);
      if (!slQty) return;

      // No mismatch → nothing to do
      if (slQty === netQty) return;

      // const orderId = this.extractOrderNo(pendingSL.orderno || pendingSL);
      // const orderId = this.extractOrderNo(pendingSL?.orderno ?? pendingSL);
      const raw = pendingSL.raw || pendingSL;
      const orderId = this.extractOrderNo(raw.orderno ?? pendingSL);
      if (!orderId) return;

      this.logger.log(`pending sl data: ${JSON.stringify(pendingSL)}`);

      // 🔒 IMPORTANT: reuse existing prices exactly
      const existingTrigger = this.extractSLTriggerPrice(pendingSL);
      const existingLimit = this.extractSLLimitPrice(pendingSL);

      if (!existingTrigger || !existingLimit) {
        this.logger.error(
          `❌ Cannot sync SL qty | missing price data | order=${orderId}`,
          pendingSL,
        );
        return;
      }

      this.logger.warn(
        `⚠️ SL qty mismatch | token=${tick.tk} | SL=${slQty} | POS=${netQty}`,
      );

      this.logger.warn(`
      SL SYNC CHECK:
      token=${tick.tk}
      positionQty=${netQty}
      slQty=${slQty}
      `);

      // ✅ MODIFY ONLY QUANTITY
      // await this.ordersService.modifyOrder({
      //   orderno: orderId,
      //   exchange: tick.e,
      //   tradingsymbol: instrument.tradingSymbol,
      //   quantity: netQty,
      //   newprice_type: 'SL-LMT',
      //   newprice: existingLimit, // 🔒 unchanged
      //   newtrigger_price: existingTrigger, // 🔒 unchanged
      // });

      // instead modify cancel order
      this.logger.warn(`
⚡ SL QTY MISMATCH → CANCEL + RECREATE
token=${tick.tk}
oldQty=${slQty}
newQty=${netQty}
`);

      // 🔥 STEP 1: CANCEL OLD SL
      await this.ordersService.cancelOrder(orderId);

      // 🔥 VERY IMPORTANT: CLEAR MEMORY
      this.slPlacedMap.delete(tick.tk);

      // 🔥 ADD COOLDOWN (VERY IMPORTANT)
      this.lastSLCancelTime.set(tick.tk, Date.now());

      // 🔥 STEP 2: EXIT → let next tick place fresh SL
      return;

      // this.appendOrderLog(orderId, {
      //   action: 'SL_QTY_SYNCED',
      //   previousQty: slQty,
      //   newQty: netQty,
      //   triggerPrice: existingTrigger,
      //   limitPrice: existingLimit,
      // });

      // this.logger.log(
      //   `✅ SL quantity synced | order=${orderId} | ${slQty} → ${netQty}`,
      // );
    } catch (err) {
      this.logger.error('❌ Failed to sync SL quantity', err);
    }
  }
  // helper to get triggerprice and limit price exisiting
  private extractSLTriggerPrice(order: any): number | null {
    // return order?.trgprc ? Number(order.trgprc) : null;
    const raw = order.raw || order;
    return raw?.trgprc ? Number(raw.trgprc) : null;
  }

  private extractSLLimitPrice(order: any): number | null {
    // return order?.prc ? Number(order.prc) : null;
    const raw = order.raw || order;
    return raw?.prc ? Number(raw.prc) : null;
  }

  // private async syncStoplossQuantityWithPosition(
  //   tick: NormalizedTick,
  //   position: any,
  //   instrument: any,
  //   pendingSL: any,
  // ) {
  //   try {
  //     if (!position || !pendingSL) return;

  //     const netQty = Math.abs(Number(position.netqty));
  //     if (netQty <= 0) return;

  //     const slQty = this.getSLOrderQty(pendingSL);
  //     if (!slQty) return;

  //     // No mismatch → nothing to do
  //     if (slQty === netQty) return;

  //     const orderId = this.extractOrderNo(pendingSL.orderno || pendingSL);
  //     if (!orderId) return;

  //     const trigger = this.getSLTriggerPrice(pendingSL);
  //     if (!trigger) {
  //       this.logger.error(
  //         `❌ Cannot sync SL qty | trigger price missing | order=${orderId}`,
  //       );
  //       return;
  //     }

  //     this.logger.warn(
  //       `⚠️ SL qty mismatch | token=${tick.tk} | SL=${slQty} | POS=${netQty}`,
  //     );

  //     // fixing tick size
  //     const normalizedTrigger = this.normalizeTriggerPrice(
  //       trigger,
  //       instrument,
  //       position.netqty > 0 ? 'BUY' : 'SELL',
  //     );
  //     // finding side and making limit price based on trigger price
  //     const side: 'BUY' | 'SELL' = Number(position.netqty) > 0 ? 'BUY' : 'SELL';
  //     const limitPrice = this.calculateSLLimitPrice(
  //       normalizedTrigger,
  //       side,
  //       instrument, // ✅ ADD
  //     );

  //     await this.ordersService.modifyOrder({
  //       orderno: orderId,
  //       exchange: tick.e,
  //       tradingsymbol: instrument.tradingSymbol,
  //       quantity: netQty,
  //       newprice_type: 'SL-LMT',
  //       newprice: limitPrice,
  //       newtrigger_price: normalizedTrigger, // 🔥 REQUIRED
  //     });

  //     this.appendOrderLog(orderId, {
  //       action: 'SL_QTY_SYNCED',
  //       previousQty: slQty,
  //       newQty: netQty,
  //       triggerPrice: trigger,
  //     });

  //     this.logger.log(
  //       `✅ SL quantity synced | order=${orderId} | ${slQty} → ${netQty}`,
  //     );
  //   } catch (err) {
  //     this.logger.error('❌ Failed to sync SL quantity', err);
  //   }
  // }

  /**
   * Normalize trigger price so that:
   * 1) It is an EXACT multiple of tick size
   * 2) Direction-safe (BUY floor, SELL ceil)
   * 3) No floating-point drift
   */
  private normalizeTriggerPrice(
    rawPrice: number,
    instrument: any,
    side: 'BUY' | 'SELL',
  ): number {
    try {
      const tickSizeRaw = instrument?.tickSize ?? instrument?.raw?.TickSize;

      if (!tickSizeRaw) {
        this.logger.error(
          `❌ Tick size missing | symbol=${instrument?.tradingSymbol}`,
        );
        return Number(rawPrice.toFixed(2));
      }

      const tickSizeStr = String(tickSizeRaw).trim();
      const tickSize = Number(tickSizeStr);

      if (!Number.isFinite(tickSize) || tickSize <= 0) {
        this.logger.error(
          `❌ Invalid tick size "${tickSizeRaw}" | symbol=${instrument?.tradingSymbol}`,
        );
        return Number(rawPrice.toFixed(2));
      }

      // 🔒 INTEGER TICK MATH — NO FLOAT MODULO
      const ticks = rawPrice / tickSize;

      const roundedTicks =
        side === 'BUY' ? Math.floor(ticks) : Math.ceil(ticks);

      const normalized = roundedTicks * tickSize;

      // decimals derived from tick size STRING
      const decimals = tickSizeStr.includes('.')
        ? tickSizeStr.split('.')[1].length
        : 0;

      const finalPrice = Number(normalized.toFixed(decimals));

      this.logger.log(
        `TICK_CHECK | raw=${rawPrice} | tick=${tickSizeStr} | final=${finalPrice}`,
      );

      return finalPrice;
    } catch (err) {
      this.logger.error(
        `❌ Tick normalization failed | raw=${rawPrice}`,
        err?.message || err,
      );
      return Number(rawPrice.toFixed(2));
    }
  }

  //reusable helper function for calculating sl limit price
  private calculateSLLimitPrice(
    triggerPrice: number,
    slOrderSide: 'BUY' | 'SELL',
    instrument: any,
  ): number {
    const buffer = triggerPrice * this.SL_LIMIT_PCT;

    // 🔒 RAW price must already be on correct side
    const rawPrice =
      slOrderSide === 'SELL'
        ? triggerPrice - buffer // SELL SL → BELOW trigger
        : triggerPrice + buffer; // BUY SL → ABOVE trigger

    return this.normalizeLimitPrice(rawPrice, instrument, slOrderSide);
  }
  // helper to normallize limit price
  private normalizeLimitPrice(
    rawPrice: number,
    instrument: any,
    side: 'BUY' | 'SELL',
  ): number {
    try {
      const tickSizeRaw = instrument?.tickSize ?? instrument?.raw?.TickSize;
      if (!tickSizeRaw) return Number(rawPrice.toFixed(2));

      const tickSizeStr = String(tickSizeRaw).trim();
      const tickSize = Number(tickSizeStr);
      if (!Number.isFinite(tickSize) || tickSize <= 0)
        return Number(rawPrice.toFixed(2));

      const ticks = rawPrice / tickSize;

      // 🔥 OPPOSITE rounding vs trigger
      const roundedTicks =
        side === 'SELL' ? Math.floor(ticks) : Math.ceil(ticks);

      const normalized = roundedTicks * tickSize;

      const decimals = tickSizeStr.includes('.')
        ? tickSizeStr.split('.')[1].length
        : 0;

      return Number(normalized.toFixed(decimals));
    } catch {
      return Number(rawPrice.toFixed(2));
    }
  }

  // ===============================
  // HELPER TO RESOLVE CONFIG FOR STOPLOSS TRAILING BASED ON OPTINX AND FUTIDX
  // ===============================

  private getConfigForPosition(position: any) {
    const inst = position?.instname;
    const sym = position?.symname;

    // DEFAULT (existing behavior)
    let slPercent = this.SL_PERCENT;
    let firstProfit = this.FIRST_PROFIT_STAGE;
    let breakeven = Number(this.ConfigService.get('BREAKEVEN_STAGE', '0.8'));
    let targetFirst = Number(
      this.ConfigService.get('TARGET_FIRST_PERCENT', '0.25'),
    );

    // ===============================
    // OPTIDX
    // ===============================
    if (inst === 'OPTIDX') {
      slPercent = this.getEnvNumber('STANDARD_STOPLOSS_PERCENT_OPTIDX', 0.25);
      firstProfit = this.getEnvNumber('FIRST_PROFIT_STAGE_OPTIDX', 0.6);
      breakeven = this.getEnvNumber('BREAKEVEN_STAGE_OPTIDX', 0.8);
      targetFirst = this.getEnvNumber('TARGET_FIRST_PERCENT_OPTIDX', 0.25);
    }

    // ===============================
    // FUTIDX
    // ===============================
    else if (inst === 'FUTIDX') {
      // BANKNIFTY special override
      if (sym === 'BANKNIFTY') {
        slPercent = this.getEnvNumber(
          'STANDARD_STOPLOSS_PERCENT_FUTIDX_BANKNIFTY',
          0.0033,
        );
        targetFirst = this.getEnvNumber(
          'TARGET_FIRST_PERCENT_FUTIDX_BANKNIFTY',
          0.033,
        );
      } else {
        slPercent = this.getEnvNumber(
          'STANDARD_STOPLOSS_PERCENT_FUTIDX',
          0.0025,
        );
        targetFirst = this.getEnvNumber('TARGET_FIRST_PERCENT_FUTIDX', 0.025);
      }

      firstProfit = this.getEnvNumber('FIRST_PROFIT_STAGE_FUTIDX', 0.6);
      breakeven = this.getEnvNumber('BREAKEVEN_STAGE_FUTIDX', 0.8);
    }

    return {
      slPercent,
      firstProfit,
      breakeven,
      targetFirst,
    };
  }

  private getEnvNumber(key: string, defaultValue: number): number {
    const raw = this.ConfigService.get<string>(key, String(defaultValue));
    const value = Number(raw);

    if (Number.isNaN(value)) return defaultValue;

    return value > 1 ? value / 100 : value;
  }

  // fucntion to close pending target orders when position is closed without triggering sl order (core requirement)
  private async cancelPendingTargetOrders(tick: NormalizedTick) {
    try {
      const openOrders = this.orderBook?.data || [];

      // const targetOrders = openOrders.filter(
      //   (o) =>
      //     o.token === tick.tk &&
      //     o.exch === tick.e &&
      //     o.prctyp === 'LMT' &&
      //     o.status === 'OPEN' &&
      //     o.remarks === 'AUTO_TARGET_PENDING',
      // );
      const targetOrders = openOrders.filter(
        (o) =>
          (o.raw?.token || o.token) === tick.tk &&
          (o.raw?.exch || o.exch) === tick.e &&
          (o.raw?.prctyp || o.prctyp) === 'LMT' &&
          (o.raw?.status || o.status) === 'OPEN' &&
          // (o.raw?.remarks || o.remarks) === 'AUTO_TARGET_PENDING',
          (o.raw?.remarks || o.remarks)?.includes('AUTO_TARGET_PENDING'),
      );

      for (const order of targetOrders) {
        // const orderId = this.extractOrderNo(order.orderno || order);
        const orderId = this.extractOrderNo(order?.orderno ?? order);
        if (!orderId) continue;

        await this.ordersService.cancelOrder(orderId);

        this.logger.warn(`🎯 Target cancelled | ${orderId} | POSITION CLOSED`);
      }
    } catch (err) {
      this.logger.error('❌ Failed to cancel target orders', err);
    }
  }

  // helper to clear target track on position flip (core requirement to avoid stale track data)
  // private async clearTargetTrack(token: string) {
  //   try {
  //     const dir = path.join(process.cwd(), 'data/TVtargetTrack');

  //     if (!fs.existsSync(dir)) return;

  //     const files = fs.readdirSync(dir);

  //     for (const file of files) {
  //       if (file.startsWith(token)) {
  //         fs.unlinkSync(path.join(dir, file));
  //         this.logger.warn(`🧹 Cleared target track | ${file}`);
  //       }
  //     }
  //   } catch (err) {
  //     this.logger.error(`❌ Failed to clear target track`, err);
  //   }
  // }
  private clearTargetTrack(token: string) {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.join(
      process.cwd(),
      'data/TVTargetTrack',
      `TARGET_${token}.json`,
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.warn(`🧹 TARGET TRACK CLEARED | ${token}`);
    }
  }

  //ADD GLOBAL CLEAN FUNCTION
  private async clearAllStateForToken(token: string) {
    try {
      // 🔥 CLEAR SL MEMORY
      this.localOrderMemory.delete(`SL_${token}`);
      this.slPlacedTime.delete(token);
      this.lastSLCancelTime.delete(token);

      // 🔥 CLEAR POSITION STATE
      this.positionState.delete(token);

      // ✅ clear stoposs memory
      this.slPlacedMap.delete(token);

      // 🔥 CLEAR TARGET MEMORY
      this.targetManager.clearLocalTargetMemory(token);

      // 🔥 CLEAR TARGET TRACK FILES
      await this.clearTargetTrack(token);

      this.logger.warn(`🧹 FULL RESET DONE | ${token}`);
    } catch (err) {
      this.logger.error(`❌ Failed to clear full state | ${token}`, err);
    }
  }

  // ADD HELPER TO CLEAN OLD FILES (can be used on startup or via endpoint)
  private cleanOldFiles(dirPath: string) {
    try {
      if (!fs.existsSync(dirPath)) return;

      const files = fs.readdirSync(dirPath);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      for (const file of files) {
        const fullPath = path.join(dirPath, file);

        try {
          const stats = fs.statSync(fullPath);

          const fileTime = new Date(stats.mtime);

          // ❌ delete if NOT today
          if (fileTime < startOfToday) {
            fs.unlinkSync(fullPath);
            this.logger.warn(`🧹 Deleted old file: ${file}`);
          }
        } catch (err) {
          this.logger.error(`❌ Failed cleaning file ${file}`, err);
        }
      }
    } catch (err) {
      this.logger.error(`❌ Failed cleaning directory ${dirPath}`, err);
    }
  }

  private cleanAllTrackFiles() {
    // making a fucntion to be called on startup or via endpoint to clean all track files to avoid stale data issues
    const targetDir = path.join(process.cwd(), 'data/TVTargetTrack');
    const slDir = this.TRACK_DIR;

    this.cleanOldFiles(targetDir);
    this.cleanOldFiles(slDir);
  }

  private runDailyCleanupOnce() {
    const today = new Date().toISOString().slice(0, 10);

    if (this.lastCleanupDate === today) return;

    this.lastCleanupDate = today;

    this.logger.warn(`🧹 Running daily file cleanup...`);

    this.cleanAllTrackFiles();
  }

  // update sl quantity even if tick is delayed so it updates sl
  private async handleTradeBasedSLUpdate(trades: any[]) {
    try {
      if (!Array.isArray(trades)) return;

      for (const t of trades) {
        const raw = t.raw || t;

        // ✅ ONLY TARGET TRADES
        if (!(raw.remarks || '').includes('AUTO_TARGET_PENDING')) continue;

        const token = raw.token;
        const exch = raw.exch;

        // 🔥 get latest position immediately
        const positions =
          this.exchangeDataService.getFilteredNetPositions()?.data || [];

        const position = positions.find(
          (p) =>
            (p.token || p.raw?.token) === token &&
            (p.exch || p.raw?.exch) === exch &&
            Number(p.netqty || p.raw?.netqty) !== 0,
        );

        if (!position) continue;

        const instrument = this.instruments.find(
          (i) => i.token === token && i.exchange === exch,
        );

        if (!instrument) continue;

        // 🔥 find SL immediately
        const orders = this.exchangeDataService.getFilteredOrders();

        const slOrder = orders.find((o) => {
          const r = o.raw || o;

          return (
            r.token === token &&
            r.exch === exch &&
            r.prctyp === 'SL-LMT' &&
            r.status !== 'CANCELED'
          );
        });

        if (!slOrder) continue;

        this.logger.warn(`⚡ TARGET HIT → Instant SL Sync | ${token}`);

        await this.syncStoplossQuantityWithPosition(
          { tk: token, e: exch, lp: 0 },
          position,
          instrument,
          slOrder,
        );
      }
    } catch (err) {
      this.logger.error('❌ Trade-based SL sync failed', err);
    }
  }

  // clearn all old files if no position is open to avoid stale data issues (can be called on startup or via endpoint)
  private async clearAllSLTrackFilesIfNoPositions() {
    try {
      const positions =
        this.exchangeDataService.getFilteredNetPositions()?.data || [];

      const hasOpenPosition = positions.some(
        (p) => Number(p.netqty || p.raw?.netqty || 0) !== 0,
      );

      if (hasOpenPosition) {
        return; // ❌ DO NOTHING if any position exists
      }

      // ✅ DELETE ALL SL FILES
      if (!fs.existsSync(this.TRACK_DIR)) return;

      const files = fs.readdirSync(this.TRACK_DIR);

      for (const file of files) {
        const fullPath = path.join(this.TRACK_DIR, file);

        fs.unlinkSync(fullPath);
        this.logger.warn(`🧹 Deleted SL track file: ${file}`);
      }

      this.logger.warn(`🔥 ALL SL TRACK FILES CLEARED (NO POSITIONS)`);
    } catch (err) {
      this.logger.error('❌ Failed clearing SL track files', err);
    }
  }
}
