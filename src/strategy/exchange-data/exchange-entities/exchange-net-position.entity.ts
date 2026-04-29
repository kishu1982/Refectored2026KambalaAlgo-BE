import { Entity, ObjectIdColumn, Column } from 'typeorm';

@Entity('exchange_net_positions')
export class ExchangeNetPosition {
  @ObjectIdColumn()
  _id: string;

  @Column()
  token: string;

  @Column()
  tsym: string;

  @Column()
  raw: any; // store full received object
}
