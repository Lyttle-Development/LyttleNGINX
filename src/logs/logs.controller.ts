import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @UseGuards(ApiKeyGuard)
  getLogs(@Query('count', ParseIntPipe) count = 100) {
    const logs = this.logsService.getLastLogs(count);
    return { logs };
  }
}
