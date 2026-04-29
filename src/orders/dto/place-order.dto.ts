import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateIf,
} from 'class-validator';

export class PlaceOrderDto {
  @IsEnum(['B', 'S'])
  buy_or_sell: 'B' | 'S';

  @IsEnum(['C', 'M', 'H', 'I'])
  product_type: 'C' | 'M' | 'H' | 'I';

  @IsString()
  @IsNotEmpty()
  exchange: string;

  @IsString()
  @IsNotEmpty()
  tradingsymbol: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsEnum(['LMT', 'MKT', 'SL-LMT', 'SL-MKT'])
  price_type: 'LMT' | 'MKT' | 'SL-LMT' | 'SL-MKT';

  /* ---------- PRICE ---------- */

  @ValidateIf((o) => o.price_type === 'LMT' || o.price_type === 'SL-LMT')
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price?: number;

  /* ---------- TRIGGER PRICE ---------- */
  @ValidateIf((o) => o.price_type === 'SL-LMT' || o.price_type === 'SL-MKT')
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  trigger_price?: number;

  /* ---------- OPTIONAL ---------- */

  @IsOptional()
  @IsNumber()
  discloseqty?: number;

  @IsOptional()
  @IsEnum(['DAY', 'IOC'])
  retention?: string;

  @IsOptional()
  @IsEnum(['YES', 'NO'])
  amo?: 'YES' | 'NO';

  @IsOptional()
  @IsString()
  remarks?: string;
}
