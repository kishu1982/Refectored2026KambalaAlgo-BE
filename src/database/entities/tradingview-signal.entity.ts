import { Entity, ObjectIdColumn, Column, CreateDateColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('tradingview_signals')
export class TradingViewSignalEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  exchange: string;

  @Column()
  symbol: string;

  @Column()
  token?: string;

  @Column()
  side: 'BUY' | 'SELL' | 'EXIT';

  @Column()
  price?: number;

  @Column()
  interval?: string;

  @Column()
  strategy?: string;

  @Column()
  rawPayload: any;

  @CreateDateColumn()
  createdAt: Date;
}
