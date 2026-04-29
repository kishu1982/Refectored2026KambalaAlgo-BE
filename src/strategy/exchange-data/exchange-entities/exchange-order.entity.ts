import { Entity, ObjectIdColumn, Column } from 'typeorm';

@Entity('exchange_orders')
export class ExchangeOrder {
  @ObjectIdColumn()
  _id: string;

  @Column()
  norenordno: string;

  @Column()
  exchordid: string;

  @Column()
  tradeDate: string;

  // ⭐ store FULL raw object
  @Column()
  raw: any;
}
