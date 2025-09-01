import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { LogsService } from './logs.service';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  // GET /logs?count=x returns the last x log lines
  @Get()
  async getLogs(@Query('count') count?: string) {
    // Default to 10 lines if not specified
    const countNum = count ? parseInt(count, 10) : 10;
    if (isNaN(countNum) || countNum < 1 || countNum > 1000) {
      // Limit max count to 1000 for sanity and security
      throw new BadRequestException('Count must be a number between 1 and 1000');
    }
    return this.logsService.getLastLogs(countNum);
  }
}