import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FinalTradeToBePlacedEntity } from './entities/final-trade-to-be-placed.entity';
import { MongoRepository } from 'typeorm';
import { getISTTradeDate } from 'src/common/utils/date.util';
import { TradingViewSignalEntity } from 'src/database/entities/tradingview-signal.entity';
import { ConfigService } from '@nestjs/config';
import { isTradingAllowedForExchange } from 'src/common/utils/trading-time.util';

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    @InjectRepository(FinalTradeToBePlacedEntity)
    private readonly finalTradeRepo: MongoRepository<FinalTradeToBePlacedEntity>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create all saved trades
   *
   */
  async createFinalTrades(signal: TradingViewSignalEntity, configs: any[]) {
    this.logger.log('🚀 Starting generating signals cycle');

    // =====================================================
    // 🔹 IST TIME CHECK
    // =====================================================
    // time check
    const exchange = signal.exchange;

    // Apply time restriction ONLY for restricted exchanges
    if (!isTradingAllowedForExchange(exchange, this.configService)) {
      this.logger.warn(
        `⏰ Trading time restricted. Skipping signal for ${exchange}|${signal.token}|${signal.symbol}`,
      );
      return;
    }

    // time check ends

    // ✅ next steps: create trade signal data

    const tradeDate = getISTTradeDate();

    // ✅ IMPORTANT FIX
    const trades: FinalTradeToBePlacedEntity[] = [];

    for (const config of configs) {
      for (let i = 0; i < config.toBeTradedOn.length; i++) {
        const leg = config.toBeTradedOn[i];

        trades.push({
          sourceSignalId: signal._id,
          strategyName: config.strategyName,

          exchange: leg.exchange,
          symbol: leg.symbolName,
          token: leg.tokenNumber,
          side: leg.side,
          quantityLots: leg.quantityLots,
          productType: leg.productType,

          legNumber: i + 1,
          totalLegs: config.legs,

          tradeStatus: 'PENDING',
          tradeDate,
          createdAt: new Date(), // 👈 manual
        } as FinalTradeToBePlacedEntity); // 👈 optional but safe
      }
    }

    await this.finalTradeRepo.insertMany(trades);
  }

  /**
   * Get all saved trades
   * Optional filters can be added later (date, status, strategy)
   */
  async getAllTrades(): Promise<FinalTradeToBePlacedEntity[]> {
    try {
      const trades = await this.finalTradeRepo.find({
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Fetched ${trades.length} trades from database`);
      return trades;
    } catch (err) {
      this.logger.error('Failed to fetch trades from database', err?.stack);
      return []; // never crash
    }
  }

  //Get all pending trades with pending status

  async getPendingTrades(): Promise<FinalTradeToBePlacedEntity[]> {
    return this.finalTradeRepo.find({
      where: {
        tradeStatus: 'PENDING',
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async markTradePlaced(tradeId: any): Promise<void> {
    try {
      await this.finalTradeRepo.updateOne(
        { _id: tradeId },
        { $set: { tradeStatus: 'PLACED' } },
      );
    } catch (err) {
      this.logger.error(
        `Failed to mark trade PLACED | tradeId=${tradeId}`,
        err?.stack,
      );
    }
  }

  //Add FAILED status updater in TradesService
  async markTradeFailed(tradeId: any, reason?: string): Promise<void> {
    try {
      await this.finalTradeRepo.updateOne(
        { _id: tradeId },
        {
          $set: {
            tradeStatus: 'FAILED',
            failureReason: reason || 'UNKNOWN',
          },
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to mark trade FAILED | tradeId=${tradeId}`,
        err?.stack,
      );
    }
  }
}
