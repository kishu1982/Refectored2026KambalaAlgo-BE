import { Module } from '@nestjs/common';
import { ExchangeDataService } from './exchange-data.service';
import { OrdersModule } from 'src/orders/orders.module';
import { MarketModule } from 'src/market/market.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeOrder } from './exchange-entities/exchange-order.entity';
import { ExchangeTrade } from './exchange-entities/exchange-trade.entity';
import { ExchangeNetPosition } from './exchange-entities/exchange-net-position.entity';
import { ExchangeDataController } from './exchange-data.controller';

@Module({
  imports: [
    OrdersModule,
    MarketModule,
    TypeOrmModule.forFeature([ExchangeOrder]),
    TypeOrmModule.forFeature([ExchangeTrade]),
    TypeOrmModule.forFeature([ExchangeNetPosition]),
  ], // required
  providers: [ExchangeDataService],
  controllers: [ExchangeDataController], // 👈 ADD THIS
  exports: [ExchangeDataService],
})
export class ExchangeDataModule {}
