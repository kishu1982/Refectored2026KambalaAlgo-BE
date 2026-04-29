import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { TradeConfigEntity } from './entities/trade-config.entity';
import { CreateTradeConfigDto } from './dto/create-trade-config.dto';
import { TradeLeg } from './interface/trade-leg.interface';

@Injectable()
export class TradingviewTradeConfigService {
  private readonly logger = new Logger(TradingviewTradeConfigService.name);

  constructor(
    @InjectRepository(TradeConfigEntity)
    private readonly tradeConfigRepo: MongoRepository<TradeConfigEntity>,
  ) {}

  /**
   * RULE:
   * - tokenNumber + symbolName MUST be unique
   * - If exists → UPDATE only
   * - If not exists → CREATE
   */

  async saveOrUpdate(dto: CreateTradeConfigDto) {
    const filter = {
      tokenNumber: dto.tokenNumber,
      symbolName: dto.symbolName,
      side: dto.side,
    };

    let tradeLegs: TradeLeg[] = [];

    // Normalize EXIT logic
    const normalizedSide: 'BUY' | 'SELL' =
      dto.side === 'EXIT' ? 'BUY' : dto.side;

    const normalizedQuantity = dto.side === 'EXIT' ? 0 : dto.quantityLots;

    try {
      // 🔹 Build sub legs
      // 🟢 CASE 1: SINGLE LEG (AUTO)
      if (dto.legs === 1) {
        tradeLegs = [
          {
            tokenNumber: dto.tokenNumber,
            exchange: dto.exchange,
            symbolName: dto.symbolName,
            quantityLots: normalizedQuantity,
            side: normalizedSide,
            productType: dto.productType,
            strategyName: dto.strategyName,
            legs: 1,
          },
        ];
      }

      if (dto.legs > 1) {
        if (!dto.toBeTradedOn || dto.toBeTradedOn.length !== dto.legs) {
          throw new BadRequestException(
            `Invalid legs configuration: legs=${dto.legs}, but received ${
              dto.toBeTradedOn?.length || 0
            } sub legs`,
          );
        }

        tradeLegs = dto.toBeTradedOn.map((leg) => {
          const legSide: 'BUY' | 'SELL' =
            leg.side === 'EXIT' ? 'BUY' : leg.side;

          // const legQty = leg.side === 'EXIT' ? 0 : leg.quantityLots;
          const legQty = dto.side === 'EXIT' ? 0 : leg.quantityLots;

          return {
            tokenNumber: leg.tokenNumber,
            exchange: leg.exchange,
            symbolName: leg.symbolName?.trim() || dto.symbolName,
            quantityLots: legQty,
            side: legSide,
            productType: dto.productType,
            strategyName: dto.strategyName,
            legs: dto.legs,
          };
        });
      }

      const existing = await this.tradeConfigRepo.findOne({ where: filter });
      this.logger.log('dto data to be saved: ' + JSON.stringify(dto));

      if (existing) {
        existing.strategyName = dto.strategyName;
        existing.exchange = dto.exchange;
        existing.quantityLots = dto.quantityLots;
        existing.side = dto.side;
        // existing.side = normalizedSide;
        // existing.quantityLots = normalizedQuantity;
        existing.productType = dto.productType;
        existing.legs = dto.legs;
        existing.signalStatus = dto.signalStatus;
        existing.isEnabled = dto.signalStatus === 'ACTIVE';
        existing.toBeTradedOn = tradeLegs;

        return await this.tradeConfigRepo.save(existing);
      }

      // const newConfig = this.tradeConfigRepo.create({
      //   ...dto,
      const newConfig = this.tradeConfigRepo.create({
        ...dto,
        //side: normalizedSide,
        //quantityLots: normalizedQuantity,
        isEnabled: dto.signalStatus === 'ACTIVE',
        toBeTradedOn: tradeLegs,
      });

      return await this.tradeConfigRepo.save(newConfig);
    } catch (error) {
      Logger.error(
        `Failed to save/update trade config`,
        error.stack,
        'TradingviewTradeConfigService',
      );

      // If already an HTTP exception → rethrow
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Otherwise wrap safely
      throw new InternalServerErrorException(
        'Failed to save trade configuration',
      );
    }
  }

  async getActiveConfigs() {
    return this.tradeConfigRepo.find({
      where: { isEnabled: true },
    });
  }

  async getAllConfigs() {
    return this.tradeConfigRepo.find();
  }

  async findByStrategy(strategyName: string) {
    return this.tradeConfigRepo.find({
      where: { strategyName },
    });
  }

  // DELETE BY ID any trade configuration
  async deleteById(id: string) {
    try {
      if (!ObjectId.isValid(id)) {
        throw new BadRequestException('Invalid Mongo ID');
      }

      const result = await this.tradeConfigRepo.delete(new ObjectId(id));

      if (result.affected === 0) {
        throw new NotFoundException('Trade configuration not found');
      }

      return {
        success: true,
        message: 'Trade configuration deleted successfully',
        id,
      };
    } catch (error) {
      Logger.error(
        'Error deleting trade configuration by id',
        error.stack,
        'TradingviewTradeConfigService',
      );

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to delete trade configuration',
      );
    }
  }

  async findMatchingConfigs(token: string, side: 'BUY' | 'SELL' | 'EXIT') {
    const normalizedToken = String(token).trim();
    const normalizedSide = side.trim().toUpperCase();
    this.logger.log(
      `Finding matching configs | token=${normalizedToken}, side=${normalizedSide}`,
    );

    const allConfigs = await this.tradeConfigRepo.find();

    // this.logger.debug(
    //   `Available configs: ${JSON.stringify(
    //     allConfigs.map(c => ({
    //       tokenNumber: c.tokenNumber,
    //       side: c.side,
    //       isEnabled: c.isEnabled,
    //       signalStatus: c.signalStatus,
    //     })),
    //     null,
    //     2,
    //   )}`,
    // );

    return this.tradeConfigRepo.find({
      where: {
        tokenNumber: normalizedToken,
        side: normalizedSide,
        isEnabled: true,
        signalStatus: 'ACTIVE',
      },
    });
  }

  async getUniqueTokenExchangePairs(): Promise<string[]> {
    /**
     * Output example:
     * ['NSE|22', 'NSE|1594']
     */

    const configs = await this.tradeConfigRepo.find({
      where: { isEnabled: true }, // optional but recommended
    });

    const uniqueSet = new Set<string>();

    for (const config of configs) {
      if (!Array.isArray(config.toBeTradedOn)) continue;

      for (const leg of config.toBeTradedOn) {
        if (!leg?.exchange || !leg?.tokenNumber) continue;

        uniqueSet.add(`${leg.exchange}|${leg.tokenNumber}`);
      }
    }

    return Array.from(uniqueSet);
  }
}
