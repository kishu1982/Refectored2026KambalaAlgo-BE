import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateIf,
} from 'class-validator';

export class ModifyOrderDto {
  @IsString()
  orderno: string;

  @IsString()
  exchange: string;

  @IsString()
  tradingsymbol: string;


  @IsNumber()
  @IsPositive()
  newquantity?: number;
  
  @IsEnum(['LMT', 'MKT', 'SL-LMT', 'SL-MKT'])
  @IsNotEmpty()
  newprice_type: 'LMT' | 'MKT' | 'SL-LMT' | 'SL-MKT'; // 🔥 REQUIRED// 🔥 REQUIRED

  @ValidateIf((o) => o.newprice_type === 'LMT' || o.newprice_type === 'SL-LMT')
  newprice?: string;

  @ValidateIf(
    (o) => o.newprice_type === 'SL-LMT' || o.newprice_type === 'SL-MKT',
  )
  newtrigger_price?: string;

  @IsOptional()
  @IsEnum(['YES', 'NO'])
  amo?: 'YES' | 'NO';
}
