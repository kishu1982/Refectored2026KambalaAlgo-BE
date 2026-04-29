import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { TokenModule } from 'src/token/token.module';
import { TokenService } from 'src/token/token.service';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  imports: [TokenModule, TelegramModule],
  providers: [OrdersService, TokenService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
