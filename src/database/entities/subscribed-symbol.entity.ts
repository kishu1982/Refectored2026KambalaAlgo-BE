import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('subscribed_symbols')
export class SubscribedSymbolEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  exchange: string; // NSE | NFO | MCX

  @Column()
  @Index({ unique: true })
  symbol: string; // RELIANCE (GLOBAL UNIQUE)

  @Column()
  subscribedInstrument: string; // NSE|RELIANCE

  @Column()
  @Index({ unique: true })
  token: string; // 22 (GLOBAL UNIQUE)

  @Column()
  strategy: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
