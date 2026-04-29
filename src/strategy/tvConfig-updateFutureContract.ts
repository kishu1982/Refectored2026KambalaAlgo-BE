import { TradingviewTradeConfigService } from './tradingview-trade-config/tradingview-trade-config.service';
import { MarketService } from '../market/market.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Interval } from '@nestjs/schedule';
import { log } from 'console';
import { OrdersService } from 'src/orders/orders.service';

@Injectable()
export class TvConfigUpdateFutureContract implements OnModuleInit {
  private readonly logger = new Logger(TvConfigUpdateFutureContract.name);

  // =====================================================
  // ⚙️ STRIKE SETTINGS
  // =====================================================
  private readonly OTM_PERCENT = 0.015; // means 0.25%
  private readonly STRIKE_STEP = 50; // NIFTY strike interval
  // ===============================
  // 📦 INSTRUMENT MASTER
  // ===============================
  private instruments: any[] = [];
  private instrumentMap = new Map<string, any>();

  // ===============================
  // 📦 ACTIVE CONFIG DATA
  // ===============================
  private activeConfigs: any[] = [];

  // ===============================
  // 📦 NET positions  DATA
  // ===============================

  private positionMap = new Map<string, any>();

  // =====================================================
  // 📈 STORE QUOTES HERE
  // =====================================================
  private indexQuotes: Record<string, any> = {};

  // =====================================================
  // 📊 MARKET INDEX MASTER (for later checking)
  // =====================================================
  private readonly indexMaster = [
    {
      exchange: 'NSE',
      symbol: 'NIFTY',
      token: 26000,
    },
    {
      exchange: 'BSE',
      symbol: 'SENSEX',
      token: 1,
    },
    {
      exchange: 'NSE',
      symbol: 'BANKNIFTY',
      token: 26009,
    },
  ];

  constructor(
    private readonly tradeConfigService: TradingviewTradeConfigService,
    private readonly marketService: MarketService,
    private readonly orderService: OrdersService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Future Contract Update Process');
    try {
      this.loadInstruments();
      this.logger.log('Instrument Master Loaded for Future Contract Update');
    } catch (error) {
      this.logger.error('Error loading Instrument Master:', error);
    }
  }

  // =====================================================
  // 🔁 FETCH ACTIVE CONFIGS EVERY 5 SECONDS
  // =====================================================
  @Interval(5000)
  async fetchActiveConfigs() {
    try {
      const data = await this.tradeConfigService.getActiveConfigs();

      this.activeConfigs = data;

      // this.logger.log(`Active configs updated: ${data?.length || 0}`);
      // this.logger.log(`Active configs Data : `, this.activeConfigs);

      // calling get quotes data after getting active configs data
      await this.fetchIndexQuotes();
      // this.logger.log(`Index Quotes: ${JSON.stringify(this.indexQuotes)}`);

      // ===============================
      // 📊 LOAD NET POSITIONS
      // ===============================

      const positionsResponse = await this.orderService.getNetPositions();

      this.positionMap.clear();

      if (positionsResponse?.data?.length) {
        for (const pos of positionsResponse.data) {
          this.positionMap.set(pos.tsym, pos);
        }
      }

      // calling main function to update future contract strike based on spot price
      await this.processFutureContractUpdate(); // ⭐ important
    } catch (error) {
      this.logger.error('Error fetching active configs/ quotes:', error);
    }
  }

  // =====================================================
  // 📥 INSTRUMENTS
  // =====================================================
  // private loadInstruments() {
  //   this.instruments = JSON.parse(
  //     fs.readFileSync(
  //       path.join(process.cwd(), 'data/instrumentinfo/instruments.json'),
  //       'utf8',
  //     ),
  //   );
  // }

  private loadInstruments() {
    const filePath = path.join(
      process.cwd(),
      'data/instrumentinfo/instruments.json',
    );

    this.logger.log(`Loading instruments from: ${filePath}`);

    const raw = fs.readFileSync(filePath, 'utf8');

    this.logger.log(`Raw file size: ${raw.length}`);

    const data = JSON.parse(raw);

    this.logger.log(`Parsed instruments length: ${data.length}`);

    this.instruments = data;

    data.forEach((inst) => {
      this.instrumentMap.set(String(inst.token), inst);
    });
  }

  // =====================================================
  // 🔁 FUNCTION TO FETCH QUOTES
  // =====================================================
  async fetchIndexQuotes() {
    try {
      const promises = this.indexMaster.map((index) =>
        this.marketService
          .getQuotes({
            exch: index.exchange,
            token: index.token,
          })
          .then((quote) => ({
            symbol: index.symbol,
            quote,
          })),
      );

      const results = await Promise.all(promises);
      // ⭐ LOG FULL RESULT
      // this.logger.log(`Quotes Result: ${JSON.stringify(results)}`);

      results.forEach((r) => {
        this.indexQuotes[r.symbol] = r.quote;
      });

      this.logger.log('Index quotes updated');
    } catch (error) {
      this.logger.error('Error fetching index quotes:', error);
    }
  }
  // =====================================================
  // 🎯 CALCULATE NEW STRIKE FROM SPOT
  // =====================================================
  private calculateOTMStrike(
    spotPrice: number,
    optionType: 'CE' | 'PE',
  ): number {
    // convert percent to decimal
    const percentValue = this.OTM_PERCENT / 100;

    let targetPrice: number;

    if (optionType === 'CE') {
      // CE → above spot
      targetPrice = spotPrice + spotPrice * percentValue;

      // round UP for calls
      return Math.ceil(targetPrice / this.STRIKE_STEP) * this.STRIKE_STEP;
    } else {
      // PE → below spot
      targetPrice = spotPrice - spotPrice * percentValue;

      // round DOWN for puts
      return Math.floor(targetPrice / this.STRIKE_STEP) * this.STRIKE_STEP;
    }
  }

  // =====================================================
  // 🔎 FIND NEW OPTION FROM INSTRUMENT MASTER
  // =====================================================
  private findReplacementInstrument(
    symbol: string,
    expiry: string,
    optionType: 'CE' | 'PE',
    strikePrice: number,
    exchange: string,
  ) {
    return this.instruments.find(
      (inst) =>
        inst.exchange === exchange &&
        inst.symbol === symbol &&
        inst.expiry === expiry &&
        inst.optionType === optionType &&
        Number(inst.strikePrice) === Number(strikePrice),
    );
  }

  private async updateConfigWithReplacement(
    config: any,
    leg: any,
    replacement: any,
  ) {
    try {
      // ===============================
      // 🧱 Clone existing config payload
      // ===============================
      const updatedConfig = {
        ...config,

        toBeTradedOn: config.toBeTradedOn.map((existingLeg) => {
          // replace only matching leg
          if (String(existingLeg.tokenNumber) === String(leg.tokenNumber)) {
            return {
              ...existingLeg,
              tokenNumber: String(replacement.token),
              symbolName: replacement.tradingSymbol,
              exchange: replacement.exchange,
            };
          }

          return existingLeg;
        }),
      };

      // ===============================
      // 🔥 LOG UPDATED DATA
      // ===============================

      this.logger.log(
        `Updating Config -> ${config.strategyName} | ` +
          `OLD:${leg.symbolName}(${leg.tokenNumber}) ` +
          `NEW:${replacement.tradingSymbol}(${replacement.token})`,
      );

      // ===============================
      // 🚀 SAVE UPDATED CONFIG
      // ===============================

      await this.tradeConfigService.saveOrUpdate(updatedConfig);

      this.logger.log(`Config Updated Successfully`);
    } catch (error) {
      this.logger.error('Error updating config:', error);
    }
  }

  // main fucntion to process future contract update based on spot price and active configs data
  /*
scheduler
   ↓
get configs
   ↓
get quotes
   ↓
get net positions
   ↓
for each leg:
    if position open → SKIP
    else calculate strike
    find replacement
    update config


  */
  private async processFutureContractUpdate() {
    try {
      for (const config of this.activeConfigs) {
        if (!config.toBeTradedOn?.length) continue;

        for (const leg of config.toBeTradedOn) {
          // ✅ process only derivatives
          if (leg.exchange !== 'NFO' && leg.exchange !== 'BFO') {
            continue;
          }

          this.logger.debug(
            `Processing leg: ${leg.symbolName} (${leg.tokenNumber})`,
          );

          const instrument = this.instrumentMap.get(String(leg.tokenNumber));

          if (!instrument) {
            this.logger.warn(`Instrument not found for ${leg.symbolName}`);
            continue;
          }

          // ===============================
          // 🚫 SKIP NON-OPTION INDEX (OPTIDX)
          // ===============================
          if (instrument.instrument !== 'OPTIDX') {
            this.logger.warn(
              `Skipping replacement -> ${leg.symbolName} is not OPTIDX (found: ${instrument.instrument})`,
            );
            continue;
          }

          // ===============================
          // 📊 Extract required data
          // ===============================

          const expiry = instrument.expiry;
          const symbol = instrument.symbol;
          const optionType = instrument.optionType;

          // ===============================
          // 📈 Get Spot Price
          // ===============================

          const spotQuote = this.indexQuotes[symbol];

          if (!spotQuote) {
            this.logger.warn(`Spot quote missing for ${symbol}`);
            continue;
          }

          const spotPrice = parseFloat(spotQuote.lp);

          // ===============================
          // 🎯 Calculate New Strike
          // ===============================

          const newStrike = this.calculateOTMStrike(spotPrice, optionType);

          this.logger.log(
            `${symbol} | Spot:${spotPrice} | ${optionType} New Strike:${newStrike}`,
          );

          // ===============================
          // 🔎 Find replacement option
          // ===============================

          const replacement = this.findReplacementInstrument(
            symbol,
            expiry,
            optionType,
            newStrike,
            leg.exchange,
          );

          if (!replacement) {
            this.logger.warn(
              `Replacement NOT found -> ${symbol} ${expiry} ${optionType} ${newStrike}`,
            );

            continue;
          }

          // ✅ avoid unnecessary updates
          if (String(leg.tokenNumber) === String(replacement.token)) {
            continue;
          }

          this.logger.log(
            `Replace leg -> OLD:${leg.symbolName} (${leg.tokenNumber}) ` +
              `NEW:${replacement.tradingSymbol} (${replacement.token}) (${replacement.exchange})`,
          );

          // ===============================
          // 🚫 CHECK OPEN POSITION
          // ===============================

          const position = this.positionMap.get(leg.symbolName);

          if (position && Number(position.netqty) !== 0) {
            this.logger.warn(
              `Skipping update -> ${leg.symbolName} has open position (netqty=${position.netqty})`,
            );

            continue;
          }

          // ===============================
          // 🚀 UPDATE CONFIG
          // ===============================

          await this.updateConfigWithReplacement(config, leg, replacement);
        }
      }
    } catch (error) {
      this.logger.error('Error processing future contract update:', error);
    }
  }

  // private async processFutureContractUpdate() {
  //   try {
  //     this.activeConfigs.forEach((config) => {
  //       if (!config.toBeTradedOn?.length) return;

  //       config.toBeTradedOn.forEach((leg) => {
  //         // ✅ process only derivatives
  //         if (leg.exchange !== 'NFO' && leg.exchange !== 'BFO') {
  //           return;
  //         }

  //         // ✅ find instrument data
  //         this.logger.debug(
  //           `Processing leg: ${leg.symbolName} (${leg.tokenNumber})`,
  //         );

  //         // const instrument = this.instruments.find(
  //         //   (inst) => String(inst.token) === String(leg.tokenNumber),
  //         // );
  //         // checking manually with map lookup instead of find for better performance
  //         // this.logger.log(
  //         //   `Total instruments loaded: ${this.instruments.length}`,
  //         // );
  //         const test = this.instrumentMap.get('64861');
  //         // this.logger.log(`Test lookup for 64861: ${JSON.stringify(test)}`);

  //         const instrument = this.instrumentMap.get(String(leg.tokenNumber));

  //         // this.logger.debug(
  //         //   `Found instrument: ${instrument ? instrument.tradingSymbol : 'NOT FOUND'}`,
  //         // );

  //         if (!instrument) {
  //           this.logger.warn(`Instrument not found for ${leg.symbolName}`);
  //           return;
  //         }

  //         // ===============================
  //         // 📊 Extract required data
  //         // ===============================
  //         const expiry = instrument.expiry;
  //         const symbol = instrument.symbol;
  //         const optionType = instrument.optionType;
  //         const strikePrice = instrument.strikePrice;

  //         // ===============================
  //         // 📈 Get Spot Price
  //         // ===============================
  //         const spotQuote = this.indexQuotes[symbol];

  //         if (!spotQuote) {
  //           this.logger.warn(`Spot quote missing for ${symbol}`);
  //           return;
  //         }

  //         const spotPrice = parseFloat(spotQuote.lp);

  //         // ===============================
  //         // 🎯 Calculate New Strike
  //         // ===============================
  //         const newStrike = this.calculateOTMStrike(spotPrice, optionType);
  //         this.logger.log(
  //           `${symbol} | Spot:${spotPrice} | ${optionType} New Strike:${newStrike}`,
  //         );
  //         // ===============================
  //         // 🔎 Find replacement option
  //         // ===============================

  //         const replacement = this.findReplacementInstrument(
  //           symbol,
  //           expiry,
  //           optionType,
  //           newStrike,
  //           leg.exchange,
  //         );

  //         if (!replacement) {
  //           this.logger.warn(
  //             `Replacement NOT found -> ${symbol} ${expiry} ${optionType} ${newStrike}`,
  //           );

  //           return;
  //         }
  //         // ===============================
  //         // 🔥 LOG replacement data
  //         // ===============================

  //         this.logger.log(
  //           `Replace leg -> OLD:${leg.symbolName} (${leg.tokenNumber}) ` +
  //             `NEW:${replacement.tradingSymbol} (${replacement.token}) (${replacement.exchange})`,
  //         );

  //         // ===============================
  //         // 🔥 LOGGING (for now)
  //         // ===============================y

  //         // this.logger.log(
  //         //   `${symbol} | Spot: ${spotPrice} | Expiry: ${expiry} | ${optionType} | Strike: ${strikePrice}`,
  //         // );

  //         // 👉 Here later you will calculate new strike and update leg

  //         await this.updateConfigWithReplacement(config, leg, replacement);
  //       });
  //     });
  //   } catch (error) {
  //     this.logger.error('Error processing future contract update:', error);
  //   }
  // }
}
