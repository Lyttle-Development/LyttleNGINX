import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { LogsService } from './logs.service';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  getLogs(@Query('count', ParseIntPipe) count = 100) {
    const logs = this.logsService.getLastLogs(count);
    return { logs };
  }
}