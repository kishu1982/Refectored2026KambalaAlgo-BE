import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { TokenService } from 'src/token/token.service';

@Module({
  providers: [MarketService, TokenService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
