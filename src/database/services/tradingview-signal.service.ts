import { Injectable } from '@nestjs/common';
import { TradingViewSignalRepository } from '../repositories/tradingview-signal.repository';
import { TradingViewSignalEntity } from '../entities/tradingview-signal.entity';

@Injectable()
export class TradingViewSignalService {
  constructor(private readonly repo: TradingViewSignalRepository) {}

  saveSignal(data: Partial<TradingViewSignalEntity>) {
    return this.repo.save(data);
  }

  getLastSignal(symbol: string) {
    return this.repo.findLatestBySymbol(symbol);
  }
}
