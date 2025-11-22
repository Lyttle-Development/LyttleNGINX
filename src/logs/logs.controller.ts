import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-auth.guard';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  getLogs(@Query('count', ParseIntPipe) count = 100) {
    const logs = this.logsService.getLastLogs(count);
    return { logs };
  }
}
