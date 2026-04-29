import { Type } from 'class-transformer';
import {
  IsEnum,
  isNotEmpty,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { TradeLegDto } from './tarde-leg.dto';

 enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
  EXIT = 'EXIT',
}



export class CreateTradeConfigDto {
  @IsString()
  @IsNotEmpty()
  strategyName: string;

  @IsString()
  @IsNotEmpty()
  tokenNumber: string;

  @IsString()
  @IsNotEmpty()
  exchange: string;

  // ✅ NEW
  @IsString()
  @IsNotEmpty()
  symbolName: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(0, { message: 'quantityLots cannot be negative' })
  quantityLots: number;

  @IsEnum(TradeSide, { message: 'side must be one of BUY, SELL, EXIT' })
  @IsNotEmpty({
    message: 'side is required',
  })
  side: TradeSide;

  @IsEnum(['INTRADAY', 'NORMAL', 'DELIVERY'])
  @IsNotEmpty()
  productType: 'INTRADAY' | 'NORMAL' | 'DELIVERY';

  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  legs: number;

  @IsEnum(['ACTIVE', 'INACTIVE'])
  signalStatus: 'ACTIVE' | 'INACTIVE';

  // ✅ ONLY REQUIRED WHEN legs > 1
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TradeLegDto)
  toBeTradedOn?: TradeLegDto[];
}
