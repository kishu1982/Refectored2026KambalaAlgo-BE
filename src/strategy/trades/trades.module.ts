import { Module } from '@nestjs/common';
import { TradesService } from './trades.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinalTradeToBePlacedEntity } from './entities/final-trade-to-be-placed.entity';
import { TradesController } from './trades.controller';
import { TradesExecutionService } from './trades-execution.service';
import { MarketModule } from 'src/market/market.module';
import { OrdersModule } from 'src/orders/orders.module';
import { ScheduleModule } from '@nestjs/schedule';
import { StoplossTargetService } from './stoploss-target/stoploss-target.service';
import { ExchangeDataModule } from '../exchange-data/exchange-data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FinalTradeToBePlacedEntity]),
    MarketModule, // ✅ ADD THIS
    OrdersModule, // ✅ ADD THIS
    ScheduleModule.forRoot(), // TO RUN SCHEDULED JOBS FOR TRADES EXECUTION
    ExchangeDataModule,
  ],
  providers: [TradesService, TradesExecutionService, StoplossTargetService], // ✅ ADD THIS
  exports: [
    TradesService,
    TradesExecutionService,
    StoplossTargetService, // optional (only if used outside)
  ],
  controllers: [TradesController],
})
export class TradesModule {}
