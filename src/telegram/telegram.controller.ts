import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  /**
   * ✅ Simple test message
   * URL: GET http://localhost:3000/telegram/test
   */
  @Get('test')
  async testMessage() {
    await this.telegramService.sendMessage(
      '✅ Telegram Bot Working Successfully!',
    );
    return { message: 'Test message sent to Telegram' };
  }

  /**
   * ✅ Send custom message
   * URL: POST http://localhost:3000/telegram/send
   * Body: { "message": "Hello from NestJS" }
   */
  @Post('send')
  async sendCustomMessage(@Body('message') message: string) {
    await this.telegramService.sendMessage(message);
    return { message: 'Custom message sent successfully' };
  }

  /**
   * ✅ Simulate trade execution message
   * URL: GET http://localhost:3000/telegram/trade
   */
  @Get('trade')
  async simulateTrade(
    @Query('symbol') symbol: string = 'NIFTY',
    @Query('side') side: string = 'SELL',
    @Query('qty') qty: string = '50',
    @Query('price') price: string = '22150',
  ) {
    const message = `
📢 <b>TRADE EXECUTED</b>

Symbol: ${symbol}
Side: ${side}
Quantity: ${qty}
Price: ${price}
Time: ${new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
    })}
`;

    await this.telegramService.sendMessage(message);

    return { message: 'Trade simulation message sent' };
  }
}
