import { Entity, ObjectIdColumn, Column } from 'typeorm';

@Entity('exchange_trades')
export class ExchangeTrade {
  @ObjectIdColumn()
  _id: string;

  @Column()
  norenordno: string;

  @Column()
  exchordid: string;

  @Column()
  tradeDate: string;

  @Column()
  raw: any; // full received object
}
