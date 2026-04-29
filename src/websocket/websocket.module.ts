import { Module } from '@nestjs/common';
import { WebsocketService } from './websocket.service';
import { TokenModule } from 'src/token/token.module';
import { StrategyModule } from 'src/strategy/strategy.module';
import { TradingviewTradeConfigModule } from 'src/strategy/tradingview-trade-config/tradingview-trade-config.module';
import { TradesModule } from 'src/strategy/trades/trades.module';
import { ExchangeDataModule } from '@/strategy/exchange-data/exchange-data.module';

@Module({
  imports: [
    TokenModule,
    StrategyModule,
    TradingviewTradeConfigModule,
    TradesModule, // ✅ bring providers via module
    ExchangeDataModule, // 🔴 REQUIRED (used by WebsocketService)
  ],
  providers: [WebsocketService],
  exports: [WebsocketService],
})
export class WebsocketModule {}
