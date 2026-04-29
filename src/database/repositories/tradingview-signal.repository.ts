import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { TradingViewSignalEntity } from '../entities/tradingview-signal.entity';

@Injectable() // 🔴 REQUIRED
export class TradingViewSignalRepository {
  constructor(
    @InjectRepository(TradingViewSignalEntity)
    private readonly repo: MongoRepository<TradingViewSignalEntity>,
  ) {}

  save(data: Partial<TradingViewSignalEntity>) {
    return this.repo.save(data);
  }

  findLatestBySymbol(symbol: string) {
    return this.repo.findOne({
      where: { symbol },
      order: { createdAt: 'DESC' },
    });
  }
}
