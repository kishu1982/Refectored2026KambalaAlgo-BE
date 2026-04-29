import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { TokenService } from 'src/token/token.service';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';

import * as fs from 'fs-extra';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

const NorenRestApi = require('../../norenrestapi/lib/RestApi');
// const NorenRestApi = require('norenrestapi/lib/restapi');

@Injectable()
export class MarketService {
  private readonly logger = new Logger('MarketService');
  private api: any;

  // requirement for instrument download file
  private readonly DATA_DIR = path.join(
    process.cwd(),
    'data',
    'instrumentInfo',
  );
  private readonly OUTPUT_FILE = path.join(this.DATA_DIR, 'instruments.json');

  private readonly SYMBOL_URLS = [
    'https://online.moneysukh.com/NFO_symbols.txt.zip',
    'https://online.moneysukh.com/MCX_symbols.txt.zip',
    'https://online.moneysukh.com/CDS_symbols.txt.zip',
    'https://online.moneysukh.com/NSE_symbols_new.txt.zip',
    'https://online.moneysukh.com/BSE_symbols.txt.zip',
    'https://online.moneysukh.com/NSE_Index_symbols.txt.zip',
    'https://online.moneysukh.com/BFO_symbols.txt.zip',
    'https://online.moneysukh.com/BCD_symbols.txt.zip',
  ];

  constructor(
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
  ) {
    this.api = new NorenRestApi({});
  }

  async getQuotes(data: { exch: string; token: string | number }) {
    try {
      // ✅ Always returns authenticated SDK
      const api = this.tokenService.prepareSdk(this.api);

      this.logger.debug(
        `📤 SDK get_quotes → exch=${data.exch}, token=${data.token}`,
      );

      const response = await api.get_quotes(
        String(data.exch),
        String(data.token),
      );

      if (response?.stat === 'Not_Ok') {
        throw new BadRequestException(response.emsg);
      }

      return response;
    } catch (error) {
      this.logger.error('❌ getQuotes failed', error.message || error);
      throw new InternalServerErrorException('Failed to fetch market quotes');
    }
  }

  async searchScrip(searchtext: string, exch?: string) {
    try {
      const api = this.tokenService.prepareSdk(this.api);

      // ✅ Default exchange if not provided
      const exchange = exch || 'NSE';

      this.logger.debug(
        `📤 SDK searchscrip → exch=${exchange}, searchtext=${searchtext}`,
      );

      const response = await api.searchscrip(
        String(exchange),
        String(searchtext),
      );

      if (response?.stat === 'Not_Ok') {
        throw new BadRequestException({
          message: 'Noren SearchScrip failed',
          error: response.emsg,
          raw: response,
        });
      }

      return response;
    } catch (error) {
      this.logger.error('❌ SDK searchscrip failed', error.message || error);
      throw error;
    }
  }

  // /* ===================== TIME PRICE SERIES ===================== */
  // async getTimePriceSeries(params: {
  //   exchange: string;
  //   token: string;
  //   starttime: string;
  //   interval: string;
  // }) {
  //   try {
  //     const api = this.tokenService.prepareSdk(this.api);

  //     const cleanParams = {
  //       exchange: params.exchange,
  //       token: params.token,
  //       starttime: params.starttime,
  //       interval: String(params.interval), // MUST be string
  //     };

  //     this.logger.debug(
  //       `📤 SDK get_time_price_series → ${JSON.stringify(cleanParams)}`,
  //     );

  //     return await api.get_time_price_series(cleanParams);
  //   } catch (err: any) {
  //     this.logger.error(
  //       '❌ SDK get_time_price_series failed',
  //       err.message || err,
  //     );
  //     throw err;
  //   }
  // }

  // async getSecurityInfo(data: { exchange: string; token: string | number }) {
  //   const tokenInfo = this.tokenService.getToken();
  //   const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

  //   const jData = {
  //     uid: tokenInfo.UID,
  //     exch: data.exchange,
  //     token: String(data.token),
  //   };

  //   const payload = `jData=${JSON.stringify(jData)}`;

  //   this.logger.debug(`📤 GetSecurityInfo → ${payload}`);

  //   try {
  //     const response = await axios.post(`${baseUrl}/GetSecurityInfo`, payload, {
  //       headers: {
  //         Authorization: `Bearer ${tokenInfo.Access_token}`,
  //         'Content-Type': 'application/json', // matches working curl
  //       },
  //       transformRequest: [(d) => d],
  //       timeout: 10000,
  //     });

  //     if (response.data?.stat === 'Not_Ok') {
  //       throw new Error(response.data.emsg);
  //     }

  //     return response.data;
  //   } catch (error) {
  //     this.logger.error(
  //       '❌ GetSecurityInfo failed',
  //       error.response?.data || error.message,
  //     );
  //     throw error;
  //   }
  // }
  async getSecurityInfo(data: { exchange: string; token: string | number }) {
    const tokenInfo = this.tokenService.getToken();
    const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

    const jData = {
      uid: tokenInfo.UID,
      exch: data.exchange,
      token: String(data.token),
    };

    const payload = `jData=${JSON.stringify(jData)}`;

    this.logger.debug(`📤 GetSecurityInfo → ${payload}`);

    try {
      const response = await axios.post(`${baseUrl}/GetSecurityInfo`, payload, {
        headers: {
          Authorization: `Bearer ${tokenInfo.Access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        transformRequest: [(d) => d],
        timeout: 10000,
      });

      // ❗ Noren business error
      if (response.data?.stat === 'Not_Ok') {
        this.logger.warn(
          `⚠️ GetSecurityInfo Noren error: ${response.data.emsg}`,
        );
        throw new BadRequestException(response.data.emsg);
      }

      return response.data;
    } catch (err) {
      // ✅ Axios error handling
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        const norenMsg =
          err.response?.data?.emsg ||
          err.response?.data?.message ||
          err.message;

        this.logger.error(
          `❌ GetSecurityInfo Axios error`,
          JSON.stringify({
            status,
            message: norenMsg,
          }),
        );

        throw new BadRequestException(
          norenMsg || 'Failed to fetch security info',
        );
      }

      // ✅ Already a NestJS HTTP exception
      if (err instanceof BadRequestException) {
        throw err;
      }

      // ✅ Fallback (never leak raw error)
      this.logger.error(
        '❌ GetSecurityInfo unknown error',
        err?.message || err,
      );

      throw new InternalServerErrorException(
        'GetSecurityInfo failed unexpectedly',
      );
    }
  }

  /* ================= OPTION CHAIN ================= */

  async getOptionChain(data: {
    exch: string;
    tsym: string;
    strprc: number | string;
    cnt?: number | string;
  }) {
    try {
      const token = this.tokenService.getToken();
      const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

      if (!baseUrl) {
        throw new Error('NOREN_BASE_URL not configured');
      }

      if (!data?.exch || !data?.tsym || data?.strprc === undefined) {
        throw new BadRequestException('exch, tsym and strprc are required');
      }

      const jData = {
        uid: token.UID,
        exch: data.exch,
        tsym: data.tsym,
        strprc: String(data.strprc),
        cnt: data.cnt !== undefined ? String(data.cnt) : '1',
      };

      const payload = `jData=${JSON.stringify(jData)}`;

      this.logger.debug(`📤 OPTION CHAIN → ${payload}`);

      const response = await axios.post(`${baseUrl}/GetOptionChain`, payload, {
        headers: {
          Authorization: `Bearer ${token.Access_token}`,
          'Content-Type': 'text/plain', // 🔥 MUST MATCH CURL
        },
        transformRequest: [(d) => d],
        timeout: 10000,
      });

      // ❌ Logical API error
      if (response.data?.stat === 'Not_Ok') {
        throw new BadRequestException({
          message: 'GetOptionChain failed',
          error: response.data.emsg,
          raw: response.data,
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          '❌ OptionChain Axios error',
          error.response?.data || error.message,
        );

        throw new BadRequestException({
          message: 'Failed to fetch option chain',
          error: error.response?.data || error.message,
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        '❌ OptionChain unexpected error',
        error.message,
        error.stack,
      );

      throw new InternalServerErrorException(
        'Unexpected error while fetching option chain',
      );
    }
  }

  /* ===============================
     FETCH + REBUILD ALL DATA
  =============================== */
  async refreshInstrumentData(): Promise<{ count: number }> {
    await fs.ensureDir(this.DATA_DIR);

    // Remove old file
    if (await fs.pathExists(this.OUTPUT_FILE)) {
      await fs.remove(this.OUTPUT_FILE);
    }

    const allRecords: any[] = [];

    for (const url of this.SYMBOL_URLS) {
      this.logger.log(`Downloading: ${url}`);

      const zipBuffer = await axios.get(url, { responseType: 'arraybuffer' });
      const zip = new AdmZip(zipBuffer.data);

      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (!entry.entryName.endsWith('.txt')) continue;

        const csvContent = entry.getData().toString('utf8');

        const records = parse(csvContent, {
          columns: (header) =>
            header.map((h) => h.trim()).filter((h) => h.length > 0),
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
        });

        for (const row of records) {
          allRecords.push(this.normalizeRow(row));
        }
      }
    }

    await fs.writeJson(this.OUTPUT_FILE, allRecords, { spaces: 2 });

    this.logger.log(`Saved ${allRecords.length} instruments`);

    return { count: allRecords.length };
  }

  /* ===============================
     NORMALIZE ALL CSV STRUCTURES
  =============================== */
  private normalizeRow(row: any) {
    return {
      exchange: row.Exchange || null,
      token: row.Token ? String(row.Token) : null,
      symbol: row.Symbol || row.IndexName || null,
      tradingSymbol: row.TradingSymbol || null,
      expiry: row.Expiry || null,
      instrument: row.Instrument || null,
      optionType: row.OptionType || null,
      strikePrice: row.StrikePrice ? Number(row.StrikePrice) : null,
      lotSize: row.LotSize ? Number(row.LotSize) : null,
      tickSize: row.TickSize ? Number(row.TickSize) : null,
      precision: row.Precision || null,
      multiplier: row.Multiplier || null,
      indexToken: row.IndexToken || null,
      raw: row, // keep full raw row for safety/debug
    };
  }

  /* ===============================
     SEARCH / QUERY FUNCTION
  =============================== */
  async searchInstrument(params: {
    symbol: string;
    exchange?: string;
    token?: string;
  }) {
    if (!(await fs.pathExists(this.OUTPUT_FILE))) {
      throw new Error('Instrument data not found. Call refresh API first.');
    }

    const data = await fs.readJson(this.OUTPUT_FILE);

    const symbol = params.symbol.toLowerCase();

    return data.filter((item) => {
      if (!item.symbol && !item.tradingSymbol) return false;

      const symbolMatch =
        item.symbol?.toLowerCase().includes(symbol) ||
        item.tradingSymbol?.toLowerCase().includes(symbol);

      const exchangeMatch = params.exchange
        ? item.exchange === params.exchange
        : true;

      const tokenMatch = params.token
        ? item.token === String(params.token)
        : true;

      return symbolMatch && exchangeMatch && tokenMatch;
    });
  }

  /* ================= TIME PRICE SERIES ================= */

  /* ================= TIME PRICE SERIES ================= */
  // direct api
  // async getTimePriceSeries(data: {
  //   exchange: string;
  //   token: string;
  //   starttime: number;
  //   endtime: number;
  //   interval: string;
  // }) {
  //   const tokenInfo = this.tokenService.getToken();
  //   const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

  //   if (!data.starttime || !data.endtime) {
  //     throw new BadRequestException('starttime and endtime are required');
  //   }

  //   const jData = {
  //     uid: tokenInfo.UID,
  //     exch: data.exchange,
  //     token: data.token,
  //     st: String(data.starttime), // 🔥 MUST be string
  //     et: String(data.endtime), // 🔥 MUST be string
  //     intrv: data.interval, // 🔥 numeric string only
  //   };

  //   const payload = `jData=${JSON.stringify(jData)}`;

  //   this.logger.debug(`📤 TPSeries RAW → ${payload}`);

  //   //safe fuard
  //   const now = Math.floor(Date.now() / 1000);
  //   const maxAllowedEnd = now - 3600; // 1 hour buffer

  //   // if (data.endtime >= maxAllowedEnd) {
  //   //   throw new BadRequestException(
  //   //     'TPSeries does not support current day or live candles. Use WebSocket.',
  //   //   );
  //   // }

  //   try {
  //     const response = await axios.post(`${baseUrl}/TPSeries`, payload, {
  //       headers: {
  //         Authorization: `Bearer ${tokenInfo.Access_token}`,
  //         'Content-Type': 'application/x-www-form-urlencoded',
  //       },
  //       transformRequest: [(d) => d],
  //       timeout: 10000,
  //     });

  //     if (response.data?.stat === 'Not_Ok') {
  //       throw new Error(response.data.emsg);
  //     }

  //     return response.data;
  //   } catch (err: any) {
  //     this.logger.error(
  //       '❌ TPSeries failed',
  //       err?.response?.data || err.message,
  //     );

  //     throw new BadRequestException({
  //       message: 'Time price series failed',
  //       error: err?.response?.data?.emsg || err.message,
  //       raw: err?.response?.data || null,
  //     });
  //   }
  // }
  // sdk function
  async getTimePriceSeries(data: {
    exchange: string;
    token: string;
    starttime: string;
    endtime: string;
    interval?: string;
  }) {
    const tokenInfo = this.tokenService.getToken();

    if (!data.exchange || !data.token || !data.starttime || !data.endtime) {
      throw new BadRequestException(
        'exchange, token, starttime, endtime are mandatory',
      );
    }

    const api = new NorenRestApi();

    // ❗ DO NOT call injectOAuthHeader()
    api.__access_token = tokenInfo.Access_token;
    api.__username = tokenInfo.UID;
    api.__accountid = tokenInfo.Account_ID;

    // 🔥 THIS STRUCTURE IS CRITICAL
    const params = {
      exchange: data.exchange, // mapped internally to "exch"
      token: data.token,
      starttime: data.starttime, // mapped to "st"
      endtime: data.endtime, // mapped to "et"
      interval: data.interval ?? '5', // mapped to "intrv"
    };

    this.logger.debug(`📤 TPSeries RAW PARAMS → ${JSON.stringify(params)}`);

    const response = await api.get_time_price_series(params);

    if (response?.stat === 'Not_Ok') {
      throw new BadRequestException({
        message: 'Time price series failed',
        error: response.emsg,
        raw: response,
      });
    }

    return response;
  }

  /* ================= EOD PRICE SERIES ================= */

  // async getDailyPriceSeries(params: {
  //   exchange: string;
  //   tradingsymbol: string;
  //   starttime: number;
  //   endtime?: number;
  // }) {
  //   try {
  //     //const api = new (require('norenrestapi/lib/restapi'))();
  //     const api=this.api;
  //     this.tokenService.prepareSdk(api);

  //     // ✅ DO NOT touch symbol
  //     const payload = {
  //       exchange: params.exchange,
  //       tsym: params.tradingsymbol, // <-- KEEP FULL SYMBOL
  //       starttime: String(params.starttime),
  //       endtime: params.endtime ? String(params.endtime) : undefined,
  //     };

  //     this.logger.debug(
  //       `📤 SDK get_daily_price_series → ${JSON.stringify(payload)}`,
  //     );

  //     const response = await api.get_daily_price_series(payload);

  //     if (response?.stat === 'Not_Ok') {
  //       throw new Error(response.emsg);
  //     }

  //     return response;
  //   } catch (err) {
  //     this.logger.error('❌ EOD fetch failed', err.message);
  //     throw new Error(`EOD fetch failed: ${err.message}`);
  //   }
  // }
  // async getDailyPriceSeries(data: {
  //   exchange: string;
  //   tradingsymbol: string;
  //   startDate: string; // YYYY-MM-DD OR epoch
  //   endDate?: string; // YYYY-MM-DD OR epoch
  // }) {
  //   const { exchange, tradingsymbol, startDate, endDate } = data;

  //   if (!exchange || !tradingsymbol || !startDate) {
  //     throw new BadRequestException(
  //       'exchange, tradingsymbol and startDate are required',
  //     );
  //   }

  //   const api = new NorenRestApi();
  //   this.tokenService.prepareSdk(api);

  //   // 🔥 Convert to epoch seconds
  //   const starttime = this.toEpoch(startDate);
  //   const endtime = endDate ? this.toEpoch(endDate, true) : undefined;

  //   const params = {
  //     exchange,
  //     tsym: tradingsymbol,
  //     starttime,
  //     endtime,
  //   };

  //   this.logger.debug(
  //     `📤 SDK get_daily_price_series → ${JSON.stringify(params)}`,
  //   );

  //   try {
  //     return await api.get_daily_price_series(params);
  //   } catch (err) {
  //     this.logger.error('❌ EOD fetch failed', err.message);
  //     throw err;
  //   }
  // }

  /* ================= HELPERS ================= */

  private toEpoch(date: string, endOfDay = false): number {
    // Already epoch?
    if (/^\d+$/.test(date)) {
      return Number(date);
    }

    const d = new Date(date);
    if (endOfDay) {
      d.setHours(23, 59, 59, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }

    return Math.floor(d.getTime() / 1000);
  }

  /* ================= EOD CHART DATA ================= */

  async getEodChartData(data: {
    exchange: string;
    tradingsymbol: string;
    from: number; // unix timestamp (seconds)
    to?: number; // unix timestamp (seconds)
  }) {
    try {
      if (!data.exchange || !data.tradingsymbol || !data.from) {
        throw new BadRequestException(
          'exchange, tradingsymbol and from are required',
        );
      }

      const token = this.tokenService.getToken();
      const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

      if (!baseUrl) {
        throw new Error('NOREN_BASE_URL not configured');
      }

      /**
       * 🔥 API expects this EXACT format
       * sym = "NSE:INFY-EQ"
       */
      const jData: any = {
        sym: `${data.exchange}:${data.tradingsymbol}`,
        from: Number(data.from),
      };

      if (data.to) {
        jData.to = Number(data.to);
      }

      const payload = `jData=${JSON.stringify(jData)}`;

      this.logger.debug(`📤 EODChartData → ${payload}`);

      const response = await axios.post(`${baseUrl}/EODChartData`, payload, {
        headers: {
          Authorization: `Bearer ${token.Access_token}`,
          'Content-Type': 'application/json', // 🔥 MUST MATCH CURL
        },
        transformRequest: [(d) => d],
        timeout: 10000,
      });

      if (response.data?.stat === 'Not_Ok') {
        throw new BadRequestException({
          message: 'EOD chart fetch failed',
          error: response.data.emsg,
          raw: response.data,
        });
      }

      // return response.data;
      return {
        symbol: jData.sym,
        candles: this.normalizeEodData(response.data),
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          '❌ EOD Axios error',
          error.response?.data || error.message,
        );

        throw new BadRequestException({
          message: 'Failed to fetch EOD chart data',
          error: error.response?.data || error.message,
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('❌ EOD unexpected error', error.message, error.stack);

      throw new InternalServerErrorException(
        'Unexpected error while fetching EOD chart data',
      );
    }
  }

  private normalizeEodData(raw: any[]): any[] {
    if (!Array.isArray(raw)) return [];

    return raw.map((row) => {
      // Parse JSON string
      const parsed = typeof row === 'string' ? JSON.parse(row) : row;

      return {
        date: parsed.time, // keep original or convert below
        timestamp: Number(parsed.ssboe),
        open: Number(parsed.into),
        high: Number(parsed.inth),
        low: Number(parsed.intl),
        close: Number(parsed.intc),
        volume: Number(parsed.intv),
      };
    });
  }

  // eod data logic ends //
}
