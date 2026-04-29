import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TradingViewStrategy } from './strategies/tradingview.strategy';
import { TradingViewWebhookDto } from './dto/tradingview-webhook.dto';
import { TradingViewSignalService } from 'src/database/services/tradingview-signal.service';
import { TradingviewTradeConfigService } from './tradingview-trade-config/tradingview-trade-config.service';
import { TradesService } from './trades/trades.service';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private readonly TRADINGVIEW_SECRET =
    process.env.TRADINGVIEW_SECRET || 'tv_secret_123';

  constructor(
    private readonly tradingViewStrategy: TradingViewStrategy,
    private readonly tradingViewSignalService: TradingViewSignalService,

    private readonly tradeConfigService: TradingviewTradeConfigService,
    private readonly tradesService: TradesService,
  ) {}

  // to get data from webhook . pass it to trading view service also save it to database
  //🔁 Webhook → Service → Config → Final Trades
  async handleTradingViewWebhook(
    payload: TradingViewWebhookDto,
  ): Promise<void> {
    try {
      /* ─────────────────────────────────────────
       0️⃣ Validate TradingView Secret
    ───────────────────────────────────────── */
      if (payload.secret !== this.TRADINGVIEW_SECRET) {
        this.logger.warn(`Invalid TradingView secret | token=${payload.token}`);
        return; // stop further processing safely
      }

      /* ─────────────────────────────────────────
       1️⃣ Save TradingView Signal
    ───────────────────────────────────────── */
      let signal: any = null;
      try {
        signal = await this.tradingViewSignalService.saveSignal({
          exchange: payload.exchange,
          symbol: payload.symbol,
          token: payload.token,
          side: payload.side,
          price: Number(payload.price),
          interval: payload.interval,
          strategy: payload.strategy,
          rawPayload: payload,
        });
      } catch (err) {
        this.logger.error(
          `Failed to save TradingView signal | token=${payload.token}`,
          err?.stack,
        );
      }

      /* ─────────────────────────────────────────
       2️⃣ Match Trade Configuration
    ───────────────────────────────────────── */
      let matchedConfigs: any[] = [];
      try {
        matchedConfigs = await this.tradeConfigService.findMatchingConfigs(
          payload.token,
          payload.side,
        );
      } catch (err) {
        this.logger.error(
          `Error while matching trade config | token=${payload.token}, side=${payload.side}`,
          err?.stack,
        );
      }

      if (!matchedConfigs.length) {
        this.logger.warn(
          `NO_MATCH | token=${payload.token}, side=${payload.side}`,
        );
      } else {
        /* ─────────────────────────────────────────
         3️⃣ Create Final Trades (ONLY IF MATCHED)
      ───────────────────────────────────────── */
        try {
          if (signal) {
            await this.tradesService.createFinalTrades(signal, matchedConfigs);
            this.logger.log(
              `TRADE_CREATED | token=${payload.token}, side=${payload.side}`,
            );
          } else {
            this.logger.warn(
              'Skipping createFinalTrades because signal was not saved',
            );
          }
        } catch (err) {
          this.logger.error(
            `Failed to create final trades | token=${payload.token}`,
            err?.stack,
          );
        }
      }

      /* ─────────────────────────────────────────
       4️⃣ Execute Strategy (Independent)
    ───────────────────────────────────────── */
      try {
        // temporarily disable strategy execution
        // this.tradingViewStrategy.execute(payload);
        this.logger.log(
          'Strategy execution is currently disabled on page strategy.service.ts ln 110',
        );
      } catch (err) {
        this.logger.error(
          `Strategy execution failed | token=${payload.token}`,
          err?.stack,
        );
      }
    } catch (err) {
      /* ─────────────────────────────────────────
       🔴 ABSOLUTE FAIL-SAFE
    ───────────────────────────────────────── */
      this.logger.error(
        'Unhandled error in handleTradingViewWebhook',
        err?.stack,
      );
    }
  }

  /**
   * Called for every tick coming from WebSocket
   */
  onTick(tickData: any): void {
    // Raw tick logging
   //his.logger.log(`Tick Received: ${JSON.stringify(tickData)}`);
    // tickData.tk==='49229' && tickData.lp>0? this.logger.log(`Tick Received: ${JSON.stringify(tickData.lp)}`):"";

    // tickData.lp > 0
    //   ? this.logger.log(`Tick Received: ${JSON.stringify(tickData.lp)}`)
    //   : '';

    // tickData.lp > 0 || tickData.bp1 > 0 || tickData.sp1 > 0
    //   ? console.log('tick data : ', tickData.ltp)
    //   : '';
    // Later you can route to strategies:
    // this.runScalpingStrategy(tickData);
    // this.runVWAPStrategy(tickData);
  }

  // Example placeholder strategy
  private runScalpingStrategy(tick: any) {
    // logic here
  }
}
