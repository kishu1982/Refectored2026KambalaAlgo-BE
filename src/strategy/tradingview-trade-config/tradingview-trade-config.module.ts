import { Module } from '@nestjs/common';
import { TradingviewTradeConfigService } from './tradingview-trade-config.service';
import { TradingviewTradeConfigController } from './tradingview-trade-config.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeConfigEntity } from './entities/trade-config.entity';


@Module({
  imports: [TypeOrmModule.forFeature([TradeConfigEntity])],
  providers: [TradingviewTradeConfigService],
  controllers: [TradingviewTradeConfigController],
  exports: [TradingviewTradeConfigService],
})
export class TradingviewTradeConfigModule {}
