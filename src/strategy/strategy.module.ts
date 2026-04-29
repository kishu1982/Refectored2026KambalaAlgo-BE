import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { TradingViewController } from './controllers/tradingview.controller';
import { TradingViewStrategy } from './strategies/tradingview.strategy';
import { DatabaseModule } from 'src/database/database.module';
import { MarketModule } from 'src/market/market.module';
import { OrdersModule } from 'src/orders/orders.module';
import { AutoSquareOffService } from './strategies/auto-squareoff.service';
import { TradingviewTradeConfigModule } from './tradingview-trade-config/tradingview-trade-config.module';
import { TradesModule } from './trades/trades.module';
import { TvConfigUpdateFutureContract } from './tvConfig-updateFutureContract';
import { ScheduleModule } from '@nestjs/schedule';
import { ExchangeDataModule } from './exchange-data/exchange-data.module';

@Module({
  imports: [
    DatabaseModule,
    MarketModule,
    OrdersModule,
    TradingviewTradeConfigModule,
    TradesModule,
    ExchangeDataModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [TradingViewController],
  providers: [
    StrategyService,
    TradingViewStrategy,
    AutoSquareOffService,
    TvConfigUpdateFutureContract,
  ], // 🔴 REQUIRED],
  exports: [StrategyService, TvConfigUpdateFutureContract], // 👈 IMPORTANT (used by WebSocket module)
})
export class StrategyModule {}
