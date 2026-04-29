import { Module } from '@nestjs/common';
import { NorenService } from './noren.service';

@Module({
  providers: [NorenService]
})
export class NorenModule {}
