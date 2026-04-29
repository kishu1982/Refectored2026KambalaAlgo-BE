import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrdersService } from 'src/orders/orders.service';
import { ConfigService } from '@nestjs/config';
import { MarketService } from 'src/market/market.service';

@Injectable()
export class AutoSquareOffService {
  private readonly logger = new Logger(AutoSquareOffService.name);

  private isRunning = false;
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * ⏰ CONFIGURABLE IST TIMES
   * Format: HH:mm (24-hour)
   */

  /**
   * ⏰ MULTIPLE AUTO SQUARE-OFF WINDOWS (IST)
   * - end optional → if undefined, keeps checking after start
   */
  private readonly SQUARE_OFF_WINDOWS: Array<{
    start: string;
    end?: string;
  }> = [
    { start: '12:27', end: '12:29' },
    { start: '14:57', end: '14:59' },
    { start: '15:27', end: '15:30' },
    // { start: '10:45', end: '10:55' }, // testing
    // { start: '15:25' }, // no end → infinite after start
  ];

  private activateAutoSquareOff = true;

  /*
private readonly SQUARE_OFF_START_TIME = '15:25';
private readonly SQUARE_OFF_END_TIME = undefined; // in case given undefined then will keep on checking

  */

  constructor(
    private readonly orderService: OrdersService,
    private readonly ConfigService: ConfigService,
    private readonly marketService: MarketService, // ✅ ADD THIS
  ) {
    this.activateAutoSquareOff =
      this.ConfigService.get<string>('ACTIVATE_AUTO_SQUARE_OFF', 'false') ===
      'true';
  }

  // =====================================================
  // 🔹 IST TIME HELPERS (SERVER SAFE)
  // =====================================================

  private getISTDate(): Date {
    return new Date(
      new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata',
      }),
    );
  }

  private parseTime(time: string): { hour: number; minute: number } {
    const [hour, minute] = time.split(':').map(Number);
    return { hour, minute };
  }

  private isWithinSquareOffWindow(): {
    active: boolean;
    window?: { start: string; end?: string };
  } {
    const istNow = this.getISTDate();
    const h = istNow.getHours();
    const m = istNow.getMinutes();

    for (const window of this.SQUARE_OFF_WINDOWS) {
      const start = this.parseTime(window.start);
      const end = window.end ? this.parseTime(window.end) : null;

      // ⛔ before start
      if (h < start.hour || (h === start.hour && m < start.minute)) {
        continue;
      }

      // ✅ no end → valid forever after start
      if (!end) {
        return { active: true, window };
      }

      // ⛔ after end
      if (h > end.hour || (h === end.hour && m > end.minute)) {
        continue;
      }

      // ✅ inside window
      return { active: true, window };
    }

    return { active: false };
  }

  // =====================================================
  // 🔹 AUTO SQUARE-OFF (EVERY MINUTE)
  // =====================================================

  @Cron('0 */1 * * * *', { timeZone: 'Asia/Kolkata' })
  async autoSquareOff(): Promise<void> {
    if (!this.activateAutoSquareOff) {
      return;
    }

    // 🚫 Prevent overlapping executions
    if (this.isRunning) {
      this.logger.warn('Auto Square-Off already running. Skipping...');
      return;
    }

    const windowCheck = this.isWithinSquareOffWindow();
    if (!windowCheck.active) return;

    this.isRunning = true;

    this.logger.log(
      `⏰ Auto Square-Off Window Active (${windowCheck.window!.start} → ${
        windowCheck.window!.end ?? '∞'
      } IST)`,
    );

    try {
      let hasOpenPositions = true;

      while (hasOpenPositions) {
        const netPositions = await this.orderService.getNetPositions();

        if (!netPositions?.data || !Array.isArray(netPositions.data)) {
          this.logger.warn('⚠️ No net positions found');
          break;
        }

        hasOpenPositions = false;

        for (const pos of netPositions.data) {
          const netQty = Number(pos.netqty);

          if (!netQty || netQty === 0) continue;

          hasOpenPositions = true; // still positions open

          const closeSide = netQty > 0 ? 'SELL' : 'BUY';
          const closeQty = Math.abs(netQty);

          this.logger.log(
            `🔁 Square-Off → ${pos.tsym} | ${closeSide} ${closeQty}`,
          );

          // await this.orderService.placeOrder({
          //   buy_or_sell: closeSide === 'BUY' ? 'B' : 'S',
          //   product_type: 'I',
          //   exchange: pos.exch,
          //   tradingsymbol: pos.tsym,
          //   quantity: closeQty,
          //   price_type: 'MKT',
          //   price: 0,
          //   trigger_price: 0,
          //   discloseqty: 0,
          //   retention: 'DAY',
          //   amo: 'NO',
          //   remarks: `AUTO SQUARE-OFF ${windowCheck.window!.start}-${
          //     windowCheck.window!.end ?? '∞'
          //   } IST`,
          // });
          // const success = await this.placeSquareOffWithRetry({
          //   exch: pos.exch,
          //   token: pos.token, // ⚠️ IMPORTANT: ensure token exists in pos
          //   tsym: pos.tsym,
          //   qty: closeQty,
          //   side: closeSide as 'BUY' | 'SELL',
          //   remarks: `AUTO SQUARE-OFF ${windowCheck.window!.start}-${
          //     windowCheck.window!.end ?? '∞'
          //   } IST`,
          // });
          const success = await this.placeSquareOffWithRetry({
            exch: pos.exch,
            token: pos.token,
            tsym: pos.tsym,
            qty: closeQty,
            side: closeSide as 'BUY' | 'SELL',
            productType: pos.prd as 'C' | 'M' | 'H' | 'I', // ✅ FIX
            remarks: `AUTO SQUARE-OFF ${windowCheck.window!.start}-${
              windowCheck.window!.end ?? '∞'
            } IST`,
          });

          if (!success) {
            this.logger.error(
              `❌ Skipping ${pos.tsym} after 3 failed attempts`,
            );
            continue; // move to next position
          }
          // ⏳ wait 2 seconds before next order
          await this.sleep(2000);
        }

        // ⏳ Wait before re-checking positions
        if (hasOpenPositions) {
          this.logger.log('🔄 Re-checking net positions...');
          await this.sleep(4000); // wait for exchange update
        }
      }

      this.logger.log('✅ All positions squared off successfully');
    } catch (err) {
      this.logger.error('❌ Auto square-off failed', err?.message || err);
    } finally {
      this.isRunning = false; // 🔓 release lock
    }
  }

  // @Cron('0 */1 * * * *', { timeZone: 'Asia/Kolkata' })
  // async autoSquareOff(): Promise<void> {
  //   if (!this.activateAutoSquareOff) {
  //     this.logger.log('Auto Square-Off is deactivated. Skipping check.');
  //     return;
  //   }
  //   const windowCheck = this.isWithinSquareOffWindow();
  //   if (!windowCheck.active) return;

  //   this.logger.log(
  //     `⏰ Auto Square-Off Window Active (${windowCheck.window!.start} → ${
  //       windowCheck.window!.end ?? '∞'
  //     } IST)`,
  //   );

  //   try {
  //     const netPositions = await this.orderService.getNetPositions();

  //     if (!netPositions?.data || !Array.isArray(netPositions.data)) {
  //       this.logger.warn('⚠️ No net positions found');
  //       return;
  //     }

  //     for (const pos of netPositions.data) {
  //       const netQty = Number(pos.netqty);

  //       if (!netQty || netQty === 0) continue;

  //       const closeSide = netQty > 0 ? 'SELL' : 'BUY';
  //       const closeQty = Math.abs(netQty);
  //       console.log('position data at auto-squareoff:', pos);
  //       this.logger.log(
  //         `🔁 Square-Off → ${pos.tsym} | ${closeSide} ${closeQty}`,
  //       );

  //       await this.orderService.placeOrder({
  //         buy_or_sell: closeSide === 'BUY' ? 'B' : 'S',
  //         product_type: 'I',
  //         exchange: pos.exch,
  //         tradingsymbol: pos.tsym,
  //         quantity: closeQty,
  //         price_type: 'MKT',
  //         price: 0,
  //         trigger_price: 0,
  //         discloseqty: 0,
  //         retention: 'DAY',
  //         amo: 'NO',
  //         remarks: `AUTO SQUARE-OFF ${windowCheck.window!.start}-${
  //           windowCheck.window!.end ?? '∞'
  //         } IST`,
  //       });
  //     }

  //     this.logger.log('✅ Auto square-off cycle completed');
  //   } catch (err) {
  //     this.logger.error('❌ Auto square-off failed', err?.message || err);
  //   }
  // }

  //Add getLimitPrice()
  private async getLimitPrice(
    exch: string,
    token: string,
    side: 'BUY' | 'SELL',
  ): Promise<number | undefined> {
    try {
      const quote = await this.marketService.getQuotes({
        exch,
        token,
      });

      if (!quote || quote.stat !== 'Ok') {
        this.logger.error('Quote fetch failed', quote);
        return undefined;
      }

      if (side === 'BUY') {
        return Number(quote.sp5); // best sell
      } else {
        return Number(quote.bp5); // best buy
      }
    } catch (err) {
      this.logger.error('getLimitPrice error', err?.stack);
      return undefined;
    }
  }

  //Add Retry Order Function
  // private async placeSquareOffWithRetry(params: {
  //   exch: string;
  //   token: string;
  //   tsym: string;
  //   qty: number;
  //   side: 'BUY' | 'SELL';
  //   remarks: string;
  // }): Promise<boolean>
  private async placeSquareOffWithRetry(params: {
    exch: string;
    token: string;
    tsym: string;
    qty: number;
    side: 'BUY' | 'SELL';
    productType: 'C' | 'M' | 'H' | 'I';
    remarks: string;
  }): Promise<boolean> {
    const MAX_RETRY = 3;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const price = await this.getLimitPrice(
          params.exch,
          params.token,
          params.side,
        );

        if (!price) {
          this.logger.error(`❌ Attempt ${attempt}: Price not available`);
          continue;
        }

        this.logger.log(`🟡 Attempt ${attempt}: Square-off LMT @ ${price}`);

        // await this.orderService.placeOrder({
        //   buy_or_sell: params.side === 'BUY' ? 'B' : 'S',
        //   // product_type: 'I',
        //   product_type: params.productType,
        //   exchange: params.exch,
        //   tradingsymbol: params.tsym,
        //   quantity: params.qty,
        //   price_type: 'LMT',
        //   price: price,
        //   trigger_price: 0,
        //   discloseqty: 0,
        //   retention: 'DAY',
        //   amo: 'NO',
        //   remarks: params.remarks,
        // });
        await this.orderService.placeOrder({
          buy_or_sell: params.side === 'BUY' ? 'B' : 'S',
          product_type: params.productType, // ✅ dynamic
          exchange: params.exch,
          tradingsymbol: params.tsym,
          quantity: params.qty,
          price_type: 'LMT',
          price: price,
          trigger_price: 0,
          discloseqty: 0,
          retention: 'DAY',
          amo: 'NO',
          remarks: params.remarks,
        });

        await this.sleep(800); // allow OMS update
        return true;
      } catch (err) {
        this.logger.error(`❌ Attempt ${attempt} failed`, err?.stack || err);
      }
    }

    this.logger.error('❌ Square-off failed after 3 attempts');
    return false;
  }
}
