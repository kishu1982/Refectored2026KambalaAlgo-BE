import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TradeLeg } from '../interface/trade-leg.interface';

@Entity('tradingview_trade_configs')
//@Index(['tokenNumber', 'symbolName'], { unique: true })
export class TradeConfigEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  strategyName: string;

  @Column()
  tokenNumber: string;

  @Column()
  exchange: string; // NSE | NFO | BSE | BFO

  // ✅ NEW
  @Column()
  symbolName: string;

  @Column()
  quantityLots: number;

  @Column()
  side: 'BUY' | 'SELL' | 'EXIT';

  @Column()
  productType: 'INTRADAY' | 'NORMAL' | 'DELIVERY';

  @Column()
  legs: number; // 1 or more

  @Column()
  signalStatus: 'ACTIVE' | 'INACTIVE';

  @Column()
  isEnabled: boolean;

  // ✅ NEW
  // ✅ FIXED
  @Column()
  toBeTradedOn: TradeLeg[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
