import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { NorenModule } from './noren/noren.module';
import { OrdersModule } from './orders/orders.module';
import { MarketModule } from './market/market.module';
import { ConfigModule } from '@nestjs/config';
import { TokenModule } from './token/token.module';
import { WebsocketModule } from './websocket/websocket.module';
import { DatabaseModule } from './database/database.module';
import { StrategyModule } from './strategy/strategy.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RequestLoggerMiddleware } from './common/middleware/logger/request-logger.middleware';
import { TelegramModule } from './telegram/telegram.module';
import { ExchangeDataModule } from './strategy/exchange-data/exchange-data.module';

@Module({
  imports: [
    AuthModule,
    NorenModule,
    OrdersModule,
    MarketModule,
    ConfigModule.forRoot({ isGlobal: true }),
    TokenModule,
    WebsocketModule,
    DatabaseModule,
    StrategyModule,
    ScheduleModule.forRoot(),
    TelegramModule, // ✅ REQUIRED
    ExchangeDataModule, // ✅ MUST be here
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*'); // applies to all routes
  }
}
