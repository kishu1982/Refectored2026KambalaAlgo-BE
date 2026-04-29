import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { SubscribedSymbolEntity } from './entities/subscribed-symbol.entity';

@Injectable()
export class SubscribedSymbolsService {
  constructor(
    @InjectRepository(SubscribedSymbolEntity)
    private readonly repo: MongoRepository<SubscribedSymbolEntity>,
  ) {}

  /* ======================================================
     CREATE
     ====================================================== */

  async addSymbol(data: any) {
    if (!data) {
      throw new BadRequestException('Request body is missing');
    }

    const { exchange, symbol, token, strategy } = data;

    if (!exchange || !symbol || !token || !strategy) {
      throw new BadRequestException(
        'exchange, symbol, token and strategy are required',
      );
    }

    // 🔒 Symbol must be globally unique
    const existingBySymbol = await this.repo.findOne({
      where: { symbol },
    });

    if (existingBySymbol) {
      throw new ConflictException(`Symbol ${symbol} already exists`);
    }

    // 🔒 Token must be globally unique
    const existingByToken = await this.repo.findOne({
      where: { token },
    });

    if (existingByToken) {
      throw new ConflictException(`Token ${token} already exists`);
    }

    return this.repo.save({
      exchange,
      symbol,
      token,
      strategy,
      subscribedInstrument: `${exchange}|${symbol}`,
      isActive: true, // ✅ FORCE SAVE
    });
  }

  /* ======================================================
     READ
     ====================================================== */

  async getAll() {
    return this.repo.find({
      where: {
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      } as any,
    });
  }

  async getByStrategy(strategy: string) {
    return this.repo.find({
      where: {
        strategy,
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      } as any,
    });
  }

  async getByInstrument(exchange: string, symbol: string) {
    const subscribedInstrument = `${exchange}|${symbol}`;

    const result = await this.repo.findOne({
      where: { subscribedInstrument },
    });

    if (!result) {
      throw new NotFoundException('Subscribed symbol not found');
    }

    return result;
  }

  /* ======================================================
     UPDATE
     ====================================================== */

  async updateSymbol(id: string, data: Partial<SubscribedSymbolEntity>) {
    if (!data || Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    // Auto-rebuild instrument if exchange or symbol changes
    if (data.exchange && data.symbol) {
      data.subscribedInstrument = `${data.exchange}|${data.symbol}`;
    }

    const result = await this.repo.update(id as any, data);

    if (!result.affected) {
      throw new NotFoundException('Symbol not found');
    }

    return { message: 'Symbol updated successfully' };
  }

  /* ======================================================
     SOFT DELETE (RECOMMENDED)
     ====================================================== */

  async disableSymbol(id: string) {
    const result = await this.repo.update(id as any, {
      isActive: false,
    });

    if (!result.affected) {
      throw new NotFoundException('Symbol not found');
    }

    return { message: 'Symbol disabled successfully' };
  }

  /* ======================================================
     HARD DELETE (USE CAREFULLY)
     ====================================================== */

  async deleteSymbol(id: string) {
    const result = await this.repo.delete(id as any);

    if (!result.affected) {
      throw new NotFoundException('Symbol not found');
    }

    return { message: 'Symbol deleted successfully' };
  }
}
