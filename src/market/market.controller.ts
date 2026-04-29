import {
  Controller,
  Post,
  Headers,
  Body,
  BadRequestException,
  Get,
  Query,
} from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /**
   * 🔹 Get Quotes
   */
  @Post('quotes')
  getQuotes(@Body() body: { exch: string; token: string | number }) {
    return this.marketService.getQuotes(body);
  }

  /**
   * 🔹 Search Scrip
   */
  @Post('search-scrip')
  searchScrip(
    @Body()
    body: {
      exch?: string;
      searchtext?: string;
    },
  ) {
    if (!body || !body.searchtext) {
      throw new BadRequestException('searchtext is required');
    }

    return this.marketService.searchScrip(
      body.searchtext,
      body.exch, // may be undefined
    );
  }

  @Post('security-info')
  getSecurityInfo(@Body() body: { exchange: string; token: string | number }) {
    return this.marketService.getSecurityInfo(body);
  }
  // @Post('option-chain')
  // getOptionChain(
  //   @Body()
  //   body: {
  //     exchange: string;
  //     tradingsymbol: string;
  //     strikeprice: number;
  //     count?: number;
  //   },
  // ) {
  //   return this.marketService.getOptionChainRaw({
  //     exchange: body.exchange,
  //     tradingsymbol: body.tradingsymbol,
  //     strikeprice: body.strikeprice,
  //     count: body.count ?? 4,
  //   });
  // }
  @Post('time-price-series')
  getTimePriceSeries(@Body() body) {
    return this.marketService.getTimePriceSeries(body);
  }
  @Post('eod')
  async getEodData(@Body() body: any) {
    console.log('📥 RAW BODY:', body);

    const { exchange, tradingsymbol, startDate, endDate } = body;

    if (!exchange || !tradingsymbol || !startDate) {
      throw new BadRequestException(
        'exchange, tradingsymbol and startDate are required',
      );
    }

    return { ok: true };
  }

  /* ===============================
     FORCE REFRESH FROM REMOTE FILES
  =============================== */
  @Get('refresh-instruments')
  async refresh() {
    return this.marketService.refreshInstrumentData();
  }

  /* ===============================
     SEARCH INSTRUMENT
  =============================== */
  @Get('search')
  async search(
    @Query('symbol') symbol: string,
    @Query('exchange') exchange?: string,
    @Query('token') token?: string,
  ) {
    if (!symbol) {
      throw new Error('symbol is mandatory');
    }

    return this.marketService.searchInstrument({
      symbol,
      exchange,
      token,
    });
  }

  /* ================= OPTION CHAIN ================= */

  @Post('option-chain')
  async getOptionChain(
    @Body()
    body: {
      exch: string;
      tsym: string;
      strprc: number | string;
      cnt?: number | string;
    },
  ) {
    if (!body?.exch || !body?.tsym || body?.strprc === undefined) {
      throw new BadRequestException('exch, tsym and strprc are required');
    }

    return this.marketService.getOptionChain(body);
  }

  /* ================= EOD CHART DATA ================= */

  @Post('eod-chart')
  async getEodChartData(
    @Body()
    body: {
      exchange: string;
      tradingsymbol: string;
      from: number;
      to?: number;
    },
  ) {
    if (!body.exchange || !body.tradingsymbol || !body.from) {
      throw new BadRequestException(
        'exchange, tradingsymbol and from are required',
      );
    }

    return this.marketService.getEodChartData(body);
  }
}
