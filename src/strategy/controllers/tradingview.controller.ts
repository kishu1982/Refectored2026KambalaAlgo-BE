import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { StrategyService } from '../strategy.service';
import { TradingViewWebhookDto } from '../dto/tradingview-webhook.dto';

@Controller('strategy/tradingview')
export class TradingViewController {
  constructor(private readonly strategyService: StrategyService) {}

  // webhook post should be POST https://yourdomain.com/strategy/tradingview/webhook
  @Post('webhook')
  @HttpCode(200)
  receiveTradingViewWebhook(@Body() payload: TradingViewWebhookDto) {
    console.log('webhook url controller called ');
    //console.log('data received for tv signal (controller):  ', payload);
    try {
      
      this.strategyService.handleTradingViewWebhook(payload);
      return {
        status: 'ok',
        message: 'TradingView webhook processed',
      };
    } catch (error) {
      
    }
    
    

  }
}
