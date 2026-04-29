import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { SubscribedSymbolsService } from './subscribedSymbols.service';

@Controller('database')
export class DatabaseController {
  constructor(
    private readonly subscribedSymbolsService: SubscribedSymbolsService,
  ) {}
  /* ======================================================
     CREATE
     ====================================================== */

  @Post('subscribed-symbols')
  addSymbol(@Body() body: any) {
    return this.subscribedSymbolsService.addSymbol(body);
  }

  /* ======================================================
     READ
     ====================================================== */

  @Get('subscribed-symbols')
  getAllSymbols() {
    return this.subscribedSymbolsService.getAll();
  }

  @Get('subscribed-symbols/strategy/:strategy')
  getSymbolsByStrategy(@Param('strategy') strategy: string) {
    return this.subscribedSymbolsService.getByStrategy(strategy);
  }

  @Get('subscribed-symbols/:exchange/:symbol')
  getByInstrument(
    @Param('exchange') exchange: string,
    @Param('symbol') symbol: string,
  ) {
    return this.subscribedSymbolsService.getByInstrument(exchange, symbol);
  }

  /* ======================================================
     UPDATE
     ====================================================== */

  @Patch('subscribed-symbols/:id')
  updateSymbol(@Param('id') id: string, @Body() body: any) {
    return this.subscribedSymbolsService.updateSymbol(id, body);
  }

  /* ======================================================
     SOFT DELETE (RECOMMENDED)
     ====================================================== */

  @Patch('subscribed-symbols/:id/disable')
  disableSymbol(@Param('id') id: string) {
    return this.subscribedSymbolsService.disableSymbol(id);
  }

  /* ======================================================
     HARD DELETE
     ====================================================== */

  @Delete('subscribed-symbols/:id')
  deleteSymbol(@Param('id') id: string) {
    return this.subscribedSymbolsService.deleteSymbol(id);
  }
}
