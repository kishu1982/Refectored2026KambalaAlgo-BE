import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { TradingviewTradeConfigService } from './tradingview-trade-config.service';
import { CreateTradeConfigDto } from './dto/create-trade-config.dto';

@Controller('strategy/tradingview-config')
export class TradingviewTradeConfigController {
  constructor(private readonly service: TradingviewTradeConfigService) {}

  // 🔁 UPSERT (save or update)
  @Post()
  upsert(@Body() dto: CreateTradeConfigDto) {
    return this.service.saveOrUpdate(dto);
  }

  @Get()
  getAll() {
    return this.service.getAllConfigs();
  }

  @Get('active')
  getActive() {
    return this.service.getActiveConfigs();
  }

  @Get(':strategyName')
  getByStrategy(@Param('strategyName') strategyName: string) {
    return this.service.findByStrategy(strategyName);
  }
  /**
   * DELETE using Mongo _id
   * Best for admin/debug
   */
  @Delete(':id')
  deleteById(@Param('id') id: string) {
    return this.service.deleteById(id);
  }

  // to get list of unique token-exchange pairs from all active trade configs
  @Get('subscriptions/tokens')
  getSubscriptionTokens() {
    return this.service.getUniqueTokenExchangePairs();
  }
}
