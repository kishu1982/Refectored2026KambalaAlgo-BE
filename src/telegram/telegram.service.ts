import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;
  private readonly chatId = process.env.TELEGRAM_CHAT_ID;

  async sendMessage(message: string) {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

      this.logger.log(`Sending to URL: ${url}`);
      this.logger.log(`Chat ID: ${this.chatId}`);

      const response = await axios.post(url, {
        chat_id: this.chatId,
        text: message,
      });

      this.logger.log('Telegram response:');
      this.logger.log(response.data);
    } catch (error: any) {
      this.logger.error('Telegram Error:');
      this.logger.error(error.response?.data || error.message);
    }
  }
}

/*

how to receive message formate

// add constructor 
constructor(
  private readonly telegramService: TelegramService,
) {}

// deleare this fucntion  in your service where you want to send message
await this.ordersService.placeOrder(orderPayload);

const message = `
📢 <b>TRADE EXECUTED</b>

Symbol: ${symbol}
Side: ${side}
Qty: ${quantity}
Price: ${price}
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
`;

await this.telegramService.sendMessage(message);

*/
