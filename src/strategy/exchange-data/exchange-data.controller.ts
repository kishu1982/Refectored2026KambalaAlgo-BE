import { Controller, Get, Post } from '@nestjs/common';
import { ExchangeDataService } from './exchange-data.service';

@Controller('exchange-data')
export class ExchangeDataController {
  constructor(private readonly exchangeDataService: ExchangeDataService) {}

  // --------------------------------
  // ORDERS
  // --------------------------------

  @Get('orders')
  getAllOrders() {
    return this.exchangeDataService.getOrders();
  }

  @Get('orders/filtered')
  getFilteredOrders() {
    return this.exchangeDataService.getFilteredOrders();
  }

  // --------------------------------
  // TRADES
  // --------------------------------

  @Get('trades')
  getAllTrades() {
    return this.exchangeDataService.getTrades();
  }

  // (Step 2 ready — once you add function)
  @Get('trades/filtered')
  getFilteredTrades() {
    return this.exchangeDataService.getFilteredTrades?.() || [];
  }

  // --------------------------------
  // NET POSITIONS
  // --------------------------------

  @Get('positions')
  getNetPositions() {
    return this.exchangeDataService.getNetPositions();
  }

  // (Step 3 ready — artificial positions)
  @Get('positions/filtered')
  getFilteredPositions() {
    return this.exchangeDataService.getFilteredNetPositions?.() || [];
  }

  // --------------------------------
  // FORCE SYNC (VERY USEFUL)
  // --------------------------------

  @Post('sync')
  async forceSync() {
    await this.exchangeDataService.forceSyncFromWebsocket();

    return {
      status: 'success',
      message: 'Exchange data synced successfully',
    };
  }
  // --------------------------------
  // HEALTH CHECK (VERY USEFUL)
  // --------------------------------
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
