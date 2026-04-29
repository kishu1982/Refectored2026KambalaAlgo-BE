import { Test, TestingModule } from '@nestjs/testing';
import { NorenService } from './noren.service';

describe('NorenService', () => {
  let service: NorenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NorenService],
    }).compile();

    service = module.get<NorenService>(NorenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
