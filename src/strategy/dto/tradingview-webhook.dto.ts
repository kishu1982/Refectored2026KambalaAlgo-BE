import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';



 enum TradeSide {
   BUY = 'BUY',
   SELL = 'SELL',
   EXIT = 'EXIT',
 }
export class TradingViewWebhookDto {
  @IsNotEmpty()
  @IsString()
  exchange: string;

  @IsNotEmpty()
  @IsString()
  symbol: string;

  @IsNotEmpty()
  @IsString()
  token: string;

  // @IsNotEmpty({ message: 'side is required CapsOn : BUY, SELL,EXIT' })
  // @IsIn(['BUY', 'SELL', 'EXIT'])
  // side: 'BUY' | 'SELL' | 'EXIT';

  @IsEnum(TradeSide, { message: 'side must be one of BUY, SELL, EXIT' })
  @IsNotEmpty({
    message: 'side is required',
  })
  side: TradeSide;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  volume?: number; // ✅ NEW

  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsString()
  interval?: string;

  @IsNotEmpty()
  @IsString()
  strategy?: string;

  @IsString()
  secret: string;
}
