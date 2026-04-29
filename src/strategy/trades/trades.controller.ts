import { Controller, Get, Logger, Post } from '@nestjs/common';
import { TradesService } from './trades.service';
import { TradesExecutionService } from './trades-execution.service';

@Controller('savedtrades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);

  constructor(
    private readonly tradesService: TradesService,
    private readonly executionService: TradesExecutionService,
  ) {}

  /**
   * GET /trades
   * Fetch all saved trades
   */
  @Get()
  async getAllTrades() {
    this.logger.log('Request received to fetch all trades');
    return this.tradesService.getAllTrades();
  }

  // for running trade execution manually
  @Post('/run')
  async runExecution(): Promise<void> {
    this.logger.log('Manual trade execution triggered');
    await this.executionService.executeTrades();
  }
}
