import { OrdersService } from 'src/orders/orders.service';
import { ConfigService } from '@nestjs/config';
import {
  appendTargetTrack,
  readTargetTrack,
  isTradeAlreadyClosed,
  countActionReason,
  canAppendAction,
  getTargetTrackKey,
} from './target.helpers';
import { processTimeBasedExit } from './timeBasedExit.helper';
import { IsNumber, IsString } from 'class-validator';
import { Logger } from '@nestjs/common';
import { ExchangeDataService } from '@/strategy/exchange-data/exchange-data.service';

export class TargetManager {
  private readonly TARGET_PERCENT: number;
  // private readonly targetLocks = new Set<string>();
  private readonly TARGET_EXIT_PERCENT: number;
  private readonly logger = new Logger(TargetManager.name);

  private localTargetMemory = new Map<string, number>(); // to add cooling period for targets
  private inFlightTargets = new Set<string>(); //ADD “IN-FLIGHT LOCK” to avoid duplicacy
  private globalTargetLock = new Set<string>(); // GLOBAL TOKEN LOCK (MOST IMPORTANT)

  // private targetPlacedMap = new Map<string, string>();
  // private targetPlacedTime = new Map<string, number>();

  constructor(
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
    private readonly exchangeDataService: ExchangeDataService, // ✅ ADD
  ) {
    const raw = this.config.get<string>('TARGET_FIRST_PERCENT', '0.25');
    const value = Number(raw);
    this.TARGET_PERCENT = value > 1 ? value / 100 : value;

    // profit booking part to change percentage
    const rawExit = this.config.get<string>('TARGET_EXIT_PERCENT', '0.5');
    const exitValue = Number(rawExit);
    this.TARGET_EXIT_PERCENT = exitValue > 1 ? exitValue / 100 : exitValue;
  }

  // main fucntion to check and process target bookin g
  async checkAndProcessTarget({
    tick,
    netPosition,
    tradeBook,
    instrument,
    config,
  }: {
    tick: { tk: string; e: string; lp: number };
    netPosition: any;
    tradeBook: any[];
    instrument: any;
    config?: {
      targetFirst: number;
    };
  }) {
    // this.logger.debug(
    //   `Checking target for ${tick.e} ${tick.tk} at LTP ${tick.lp} with net position ${netPosition.netqty}`,
    // );
    const TARGET_PERCENT = config?.targetFirst ?? this.TARGET_PERCENT;

    const token = tick.tk;
    const ltp = tick.lp;

    // putting check for checking netpostion again before starting process
    const livePositions =
      this.exchangeDataService.getFilteredNetPositions()?.data || [];

    const livePosition = livePositions.find(
      (p) =>
        (p.token || p.raw?.token) === token &&
        (p.exch || p.raw?.exch) === tick.e &&
        Number(p.netqty || p.raw?.netqty) !== 0,
    );

    if (!livePosition) {
      this.logger.warn(`⛔ SKIP TARGET — NO LIVE POSITION | ${token}`);
      return;
    }
    // chekcing complete net position data before processing target

    // const existingTargetOrder = this.exchangeDataService
    //   .getFilteredOrders() // or pass orderBook from service
    //   .find((o) => {
    //     const raw = o.raw || o;

    //     return (
    //       raw.token === token &&
    //       raw.exch === tick.e &&
    //       raw.prctyp === 'LMT' &&
    //       // ['OPEN', 'TRIGGER_PENDING'].includes(raw.status) &&
    //       raw.status === 'OPEN' &&
    //       (raw.remarks || '').includes('AUTO_TARGET_PENDING')
    //     );
    //   });
    const existingTargetOrder = this.exchangeDataService
      .getFilteredOrders()
      .find((o) => {
        const raw = o.raw || o;

        return (
          raw.token === token &&
          raw.exch === tick.e &&
          raw.prctyp === 'LMT' &&
          ['OPEN', 'TRIGGER_PENDING'].includes(raw.status) &&
          (raw.remarks || '').startsWith('AUTO_TARGET_PENDING')
        );
      });

    // if (existingTargetOrder) {
    //   this.logger.warn(`⏳ Target already pending | ${token}`);
    //   return;
    // }

    if (existingTargetOrder) {
      this.logger.warn(`⏳ Target already pending | ${token}`);

      const trackKey = `TARGET_${token}`;
      const track = readTargetTrack(trackKey);

      const alreadyTracked = track?.some(
        (t) => t.action === 'TARGET_ORDER_PLACED',
      );

      if (!alreadyTracked) {
        const raw = existingTargetOrder.raw || existingTargetOrder;

        appendTargetTrack(trackKey, {
          action: 'TARGET_ORDER_PLACED',
          orderId: raw.norenordno,
          entryPrice: Number(raw.avgprc || 0),
          targetPrice: Number(raw.prc || 0),
          closeQty: Number(raw.qty || 0),
          time: new Date().toISOString(),
        });

        this.logger.warn(`🧠 Recovered missing target track | ${token}`);
      }

      return;
    }

    // const netQty = Math.abs(Number(netPosition.netqty));
    const netQty = Math.abs(
      Number(livePosition.netqty || livePosition.raw?.netqty),
    );
    if (netQty <= 0) return;
    // this.logger.debug(
    //   `Net quantity is ${netQty}, proceeding with target check...`,
    // );

    // const positionSide = Number(netPosition.netqty) > 0 ? 'BUY' : 'SELL';
    const positionSide =
      Number(livePosition.netqty || livePosition.raw?.netqty) > 0
        ? 'BUY'
        : 'SELL';
    // const entryTradeSide = positionSide === 'BUY' ? 'B' : 'S';
    const entryTradeSide = positionSide === 'BUY' ? 'B' : 'S';

    // const entryTrades = tradeBook
    //   .filter(
    //     (t) =>
    //       t.token === token &&
    //       t.exch === tick.e &&
    //       t.trantype === entryTradeSide,
    //   )
    //   .sort(
    //     (a, b) => new Date(b.exch_tm).getTime() - new Date(a.exch_tm).getTime(),
    //   );
    // 🔥 OLD LOGIC — RECONSTRUCT REAL POSITION ENTRY
    // const entryTrade = tradeBook
    //   .filter((t) => {
    //     const raw = t.raw || t;

    //     return (
    //       raw.token === token &&
    //       raw.exch === tick.e &&
    //       raw.trantype === entryTradeSide
    //     );
    //   })
    //   .sort(
    //     (a, b) =>
    //       new Date(b.raw?.exch_tm || b.exch_tm).getTime() -
    //       new Date(a.raw?.exch_tm || a.exch_tm).getTime(),
    //   )[0];
    const entryTrade = tradeBook
      .filter((t) => {
        const raw = t.raw || t;

        return (
          raw.token === token &&
          raw.exch === tick.e &&
          raw.trantype === entryTradeSide
        );
      })
      .sort(
        (a, b) =>
          new Date(b.raw?.exch_tm || b.exch_tm).getTime() -
          new Date(a.raw?.exch_tm || a.exch_tm).getTime(),
      )[0];

    if (!entryTrade) {
      this.logger.error(`❌ NO ENTRY TRADE FOUND | token=${token}`);
      return;
    }

    const rawEntry = entryTrade.raw || entryTrade;

    const entryOrderId = rawEntry.norenordno;

    const entryPrice = Number(rawEntry.flprc || rawEntry.prc || 0);

    //
    if (!entryPrice || isNaN(entryPrice)) {
      this.logger.error(
        `❌ INVALID ENTRY PRICE | raw=${JSON.stringify(rawEntry)}`,
      );
      return;
    }
    if (!entryOrderId) return;

    this.logger.debug(
      `Entry price is ${entryPrice}, calculating target at ${TARGET_PERCENT * 100}%...`,
    );
    // this.logger.debug(
    //   `entryorderid is ${entryOrderId}, token is ${token}, exchange is ${tick.e} checking....`,
    // );

    // const trackKey = getTargetTrackKey(token, entryOrderId);
    const trackKey = `TARGET_${token}`;
    const track = readTargetTrack(trackKey);

    // const alreadyPlaced = track?.some(
    //   (t) => t.action === 'TARGET_ORDER_PLACED',
    // );

    // if (alreadyPlaced) {
    //   this.logger.warn(`⛔ Target already placed | ${trackKey}`);
    //   return;
    // }

    // ===========================
    // ====
    // 🚀 Time Based Exit
    // ===============================
    await this.handleTimeBasedExit({
      tick,
      netPosition,
      instrument,
      entryOrderId,
    });

    // ===============================
    // 🚫 TRADE CLOSED
    // ===============================
    if (isTradeAlreadyClosed(track)) return;
    // ===============================
    // 🚫 ALREADY PLACED (ADD HERE)
    // ===============================
    // 🔥 DOUBLE CHECK FROM TRADEBOOK (REAL EXECUTION)

    // ===============================
    // 🔍 CHECK IF TARGET ALREADY EXECUTED
    // ===============================
    const placedOrder = track.find((t) => t.action === 'TARGET_ORDER_PLACED');

    if (placedOrder?.orderId) {
      const matched = tradeBook.find((t) => {
        const raw = t.raw || t;

        return raw.norenordno === placedOrder.orderId;
      });

      if (matched) {
        appendTargetTrack(trackKey, {
          action: 'TARGET_BOOKED_50_PERCENT',
        });
        return;
      }
    }

    // ===============================
    // 🚫 ALREADY PLACED
    // ===============================

    // const existingTarget = this.targetPlacedMap.get(trackKey);
    // if (existingTarget) return;

    // ===============================
    // 🎯 CALCULATE TARGET
    // ===============================
    const side = positionSide;

    // ===============================
    // 🎯 CALCULATE TARGET (FIXED PRECISION)
    // ===============================
    const targetPriceRaw =
      side === 'BUY'
        ? entryPrice * (1 + TARGET_PERCENT)
        : entryPrice * (1 - TARGET_PERCENT);

    const targetPrice = Number(targetPriceRaw.toFixed(2));

    if (targetPrice <= 0) return;

    // ===============================
    // 📏 DISTANCE FILTER (IMPORTANT)
    // ===============================
    // const distance = Math.abs(ltp - targetPrice) / ltp;
    // if (distance > 0.05) return;
    const distance = Math.abs(ltp - targetPrice) / ltp;

    // skip ONLY if extremely far (like bad calculation)
    if (distance > 1) {
      this.logger.warn(`❌ Target too far. Skipping. Distance: ${distance}`);
      return;
      //done
    }

    // ===============================
    // 📦 LOT LOGIC
    // ===============================
    const lotSize = Number(instrument.lotSize || instrument.lotsize || 1);

    // if (netQty <= lotSize) return;
    // if (netQty == 0) return;
    if (netQty <= 0) return;

    const rawCloseQty = netQty * this.TARGET_EXIT_PERCENT;
    const closeQty = Math.floor(rawCloseQty / lotSize) * lotSize;

    // if (closeQty < lotSize) return;
    // if (closeQty < lotSize) {
    //   this.logger.log(
    //     `Calculated close quantity ${closeQty} is less than lot size ${lotSize}, skipping target booking.============================`,
    //   );
    //   return;
    // }

    let finalQty = closeQty;

    if (finalQty < lotSize) {
      finalQty = netQty; // 🔥 fallback to full qty
    }

    //Validate quantity before placing
    if (closeQty % lotSize !== 0) {
      this.logger.error(`❌ INVALID LOT SIZE QUANTITY: ${closeQty}`);
      return;
    }

    // ===============================
    // 🔁 RETRY LOGIC
    // ===============================
    const retryCount = track.filter(
      (t) => t.action === 'TARGET_ORDER_RETRY',
    ).length;

    if (retryCount >= 3) return;

    const lastRetry = [...track]
      .reverse()
      .find((t) => t.action === 'TARGET_ORDER_RETRY');

    if (lastRetry) {
      const lastTime = new Date(lastRetry.time).getTime();
      if (Date.now() - lastTime < 2000) return;
    }

    // ===============================
    // 🔒 LOCK
    // ===============================
    // if (this.targetLocks.has(trackKey)) return;
    // this.targetLocks.add(trackKey);

    try {
      const latestTrack = readTargetTrack(trackKey);

      const bookedInsideLock = latestTrack?.some(
        (t) => t.action === 'TARGET_BOOKED_50_PERCENT',
      );
      if (bookedInsideLock) return;

      // check for if target order already placed inside lock to prevent duplicate target placement in case of quick successive ticks and also to prevent placing multiple targets in case of multiple retries due to any reason like exchange issues, network issues etc. this is important check to prevent duplicate target placement after lock and before order placement which is critical time window for duplicacy
      const alreadyPlacedInsideLock = latestTrack?.some(
        (t) => t.action === 'TARGET_ORDER_PLACED',
      );
      if (alreadyPlacedInsideLock) return;

      // ===============================
      // 💰 PRICE CALCULATION
      // ===============================
      // const roundToTick = (price: number) => Math.round(price * 20) / 20;

      // ===============================
      // 💰 PRICE CALCULATION
      // ===============================
      const tickSize = Number(
        instrument.tickSize || instrument.tick_size || 0.05,
      );

      const roundToTick = (price: number) =>
        Math.round(price / tickSize) * tickSize;

      // default → pending target order
      let limitPrice = roundToTick(targetPrice);

      // ===============================
      // ⚡ TARGET HIT → EXECUTE IMMEDIATELY
      // ===============================
      const isTargetHit =
        (side === 'BUY' && ltp >= targetPrice) ||
        (side === 'SELL' && ltp <= targetPrice);

      if (isTargetHit) {
        this.logger.warn(`⚡ Target already crossed, placing aggressive order`);

        // IMPORTANT: reverse side execution
        if (side === 'BUY') {
          limitPrice = roundToTick(ltp - tickSize); // SELL
        } else {
          limitPrice = roundToTick(ltp + tickSize); // BUY
        }
      }
      // ===============================
      // 🧾 DEBUG LOG
      // ===============================
      this.logger.warn(`
      PRICE DEBUG:
      TargetPrice: ${targetPrice}
      FinalLimitPrice: ${limitPrice}
      LTP: ${ltp}
      TickSize: ${tickSize}
      `);

      // ===============================
      // 🚀 Updating product type dynamicaly
      // ===============================
      let productType = netPosition.prd;

      if (tick.e === 'NFO' || tick.e === 'BFO') {
        if (!['MIS', 'NRML'].includes(productType)) {
          productType = 'NRML';
        }
      }

      if (tick.e === 'NFO' || tick.e === 'BFO') {
        this.logger.warn(`⚠️ F&O ORDER FLOW DETECTED`);
      }

      // ===============================
      // 🚀 PLACE ORDER
      // ===============================

      try {
        // =============================== target duplicacy guard ===============================
        const justPlacedKey = `JUST_${trackKey}`;
        if (this.localTargetMemory.has(justPlacedKey)) {
          this.logger.warn(`⛔ JUST PLACED BLOCK TARGET | ${trackKey}`);
          return;
        }

        // global lock for stoping duplicacy
        if (this.globalTargetLock.has(trackKey)) {
          this.logger.warn(`⛔ GLOBAL LOCK TARGET | ${trackKey}`);
          return;
        }

        this.globalTargetLock.add(trackKey);
        // updated global lock with token

        this.logger.warn(`
        ========== TARGET DEBUG ==========
        Exchange: ${tick.e}
        Symbol: ${instrument.tradingSymbol}
        Side: ${side}
        PositionSide: ${positionSide}
        EntryPrice: ${entryPrice}
        LTP: ${ltp}
        TargetPrice: ${targetPrice}
        LimitPrice: ${limitPrice}
        LotSize: ${lotSize}
        NetQty: ${netQty}
        CloseQty: ${closeQty}
        ProductType: ${netPosition.prd}
        =================================
        `);

        // const memKey = `TARGET_${token}`;
        const memKey = `TARGET_${trackKey}`;

        const lastLocal = this.localTargetMemory.get(memKey);
        if (lastLocal && Date.now() - lastLocal < 4000) {
          this.logger.warn(
            `⛔ LOCAL BLOCK TARGET (cooldown strong) | ${memKey}`,
          );
          return;
        }
        // if (this.localTargetMemory.has(memKey)) {
        //   this.logger.warn(`⛔ DUPLICATE BLOCK (same tick) | ${memKey}`);
        //   return;
        // }

        // check if track already has target placed order to prevent duplicate placement
        const alreadyPlacedInsideLock = latestTrack?.some(
          (t) => t.action === 'TARGET_ORDER_PLACED',
        );

        if (alreadyPlacedInsideLock) {
          this.logger.warn(`⛔ Target already placed (track) | ${trackKey}`);
          return;
        }

        // in flight lock to prevent duplicate target placement after lock and before order placement
        if (this.inFlightTargets.has(trackKey)) {
          this.logger.warn(`⛔ IN-FLIGHT BLOCK TARGET | ${trackKey}`);
          return;
        }

        this.inFlightTargets.add(trackKey);
        // check end - important to prevent duplicate target placement after lock and before order placement

        // adding card before placing target order
        if (netQty <= 0) {
          this.logger.warn(`⛔ FINAL BLOCK TARGET — netQty=0 | ${token}`);
          return;
        }
        // guard ends

        //ADD PRE-ORDER RECHECK (DOUBLE CHECK)

        // ===============================
        // 🚀 PLACE ORDER (UNCHANGED PRODUCT TYPE)
        // ===============================
        this.localTargetMemory.set(memKey, Date.now()); // cooling period rest time added memory set before placing trade
        const res = await this.ordersService.placeOrder({
          buy_or_sell: side === 'BUY' ? 'S' : 'B',
          product_type: netPosition.prd, // ✅ as per your requirement
          exchange: tick.e,
          tradingsymbol: instrument.tradingSymbol,
          // quantity: closeQty,
          quantity: finalQty,
          price_type: 'LMT',
          price: limitPrice,
          trigger_price: 0,
          retention: 'DAY',
          remarks: 'AUTO_TARGET_PENDING',
        });

        this.logger.log(
          `🎯 Target placed | ${res?.norenordno} | ${instrument.tradingSymbol} | at @ ${limitPrice} | Qty: ${closeQty} for AUTO_TARGET_PENDING limit order`,
        );

        // setting just placed key to prevent duplicate target placement in quick succession gurd updated
        this.localTargetMemory.set(justPlacedKey, Date.now());

        setTimeout(() => {
          this.localTargetMemory.delete(justPlacedKey);
        }, 5000); // 5 sec safety window

        // log full response for debugging
        this.logger.debug(`Order API response: ${JSON.stringify(res)}`);

        await this.exchangeDataService.forceSyncFromWebsocket(); //FORCE SYNC AFTER ORDER

        const orderId = res?.norenordno;

        if (!orderId) {
          appendTargetTrack(trackKey, {
            action: 'TARGET_ORDER_RETRY',
            reason: 'NO_ORDER_ID',
          });
          return;
        }

        if (orderId) {
          this.logger.log(`✅ Target order placed: ${orderId}`);

          appendTargetTrack(trackKey, {
            action: 'TARGET_ORDER_PLACED',
            entryPrice,
            targetPrice,
            closeQty: finalQty,
            orderId,
            time: new Date().toISOString(),
          });
        }

        // 🔥 REMOVE OLD TARGET_ORDER_PLACED ENTRIES (VERY IMPORTANT)
        const fs = require('fs');
        const path = require('path');

        const filePath = path.join(
          process.cwd(),
          'data/TVTargetTrack',
          `${trackKey}.json`,
        );

        // let cleanedTrack = [];
        // if (fs.existsSync(filePath)) {
        //   const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        //   cleanedTrack = existing.filter(
        //     (t) => t.action !== 'TARGET_ORDER_PLACED',
        //   );

        //   fs.writeFileSync(filePath, JSON.stringify(cleanedTrack, null, 2));
        // }

        // it was getting witten 2 times so removed it
        // // ✅ NOW ADD ONLY LATEST ORDER
        // appendTargetTrack(trackKey, {
        //   action: 'TARGET_ORDER_PLACED',
        //   entryPrice,
        //   targetPrice,
        //   closeQty,
        //   orderId,
        // });
        // appendTargetTrack(trackKey, {
        //   action: 'TARGET_ORDER_PLACED',
        //   entryPrice,
        //   targetPrice,
        //   closeQty,
        //   orderId,
        // });
        // const latestTrackAfterWrite = readTargetTrack(trackKey);

        // const exists = latestTrackAfterWrite?.some(
        //   (t) => t.action === 'TARGET_ORDER_PLACED' && t.orderId === orderId,
        // );

        // if (!exists) {
        //   appendTargetTrack(trackKey, {
        //     action: 'TARGET_ORDER_PLACED',
        //     entryPrice,
        //     targetPrice,
        //     closeQty: finalQty,
        //     orderId,
        //     time: new Date().toISOString(),
        //   });
        // }
      } catch (err) {
        appendTargetTrack(trackKey, {
          action: 'TARGET_ORDER_RETRY',
          reason: 'ORDER_FAILED',
          retryCount: retryCount + 1,
        });
      }
    } catch (error) {
      console.error('Error placing target order:', error);
    } finally {
      // this.targetLocks.delete(trackKey);
      this.inFlightTargets.delete(trackKey); // 🔥 CRITICAL
      this.globalTargetLock.delete(trackKey); // deleted token from global lock to allow future target processing for the token after current process completion
    }
  }

  // need to keep this above trade already closed fucntion check
  //  =============================== //
  // 🚀 Close open positions ORDER if no new high low hit in given N number of last minutes
  //  ===============================
  private async handleTimeBasedExit({
    tick,
    netPosition,
    instrument,
    entryOrderId,
  }: {
    tick: { tk: string; e: string; lp: number };
    netPosition: any;
    instrument: any;
    entryOrderId: string;
  }) {
    await processTimeBasedExit({
      tick,
      netPosition,
      instrument,
      entryOrderId,
      exitAfterMinutes: Number(this.config.get('TIME_EXIT_MINUTES', 15)),
      closePositionFn: async (side, qty) => {
        // await this.ordersService.placeOrder({
        //   buy_or_sell: side === 'BUY' ? 'S' : 'B',
        //   product_type: netPosition.prd,
        //   exchange: tick.e,
        //   tradingsymbol: instrument.tradingSymbol,
        //   quantity: qty,
        //   price_type: 'MKT',
        //   retention: 'DAY',
        //   remarks: 'AUTO_TIME_EXIT',
        // });
        const ltp = tick.lp;

        // const roundToTick = (price: number) => Math.round(price * 20) / 20;

        const tickSize = Number(
          instrument.tickSize || instrument.tick_size || 0.05,
        );

        const roundToTick = (price: number) =>
          Math.round(price / tickSize) * tickSize;

        const limitPrice = roundToTick(side === 'BUY' ? ltp - 0.5 : ltp + 0.5);

        await this.ordersService.placeOrder({
          buy_or_sell: side === 'BUY' ? 'S' : 'B',
          product_type: netPosition.prd,
          exchange: tick.e,
          tradingsymbol: instrument.tradingSymbol,
          quantity: qty,
          price_type: 'LMT',
          price: limitPrice,
          trigger_price: 0,
          retention: 'DAY',
          // remarks: 'AUTO_TIME_EXIT',
          remarks: 'AUTO_TIME_EXIT',
        });
      },
    });
  }

  clearLocalTargetMemory(token: string) {
    for (const key of this.localTargetMemory.keys()) {
      if (key.startsWith(`TARGET_${token}`)) {
        this.localTargetMemory.delete(key);
        this.logger.warn(`🧹 Cleared target memory | ${key}`);
      }
    }
  }
}
