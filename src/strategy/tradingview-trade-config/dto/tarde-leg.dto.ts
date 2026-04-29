import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
  EXIT = 'EXIT',
}

export class TradeLegDto {
  @IsString()
  tokenNumber: string;

  @IsString()
  exchange: string;

  @IsNumber()
  @Min(0, { message: 'quantityLots cannot be negative' })
  quantityLots: number;

  @IsString()
  @IsOptional()
  symbolName?: string;

  @IsEnum(TradeSide, { message: 'side must be one of BUY, SELL, EXIT' })
  @IsNotEmpty({
    message: 'side is required',
  })
  side: TradeSide;
}
