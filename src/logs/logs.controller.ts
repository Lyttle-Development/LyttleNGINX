import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('logs')
@AuthorizeAdmin('operator')
export class LogsController {
  private readonly logsService: LogsService;

  constructor(logsService: LogsService) {
    this.logsService = logsService;
  }

  @Get()
  @UseGuards(ApiKeyGuard)
  @Audit({ action: 'logs.read' })
  getLogs(@Query('count', ParseIntPipe) count = 100) {
    const entries = this.logsService.getLastLogs(count);
    const logs =
      typeof this.logsService.getLastLogLines === 'function'
        ? this.logsService.getLastLogLines(count)
        : entries.map((entry) =>
            typeof entry === 'string' ? entry : JSON.stringify(entry),
          );

    return {
      count: entries.length,
      logs,
      entries,
    };
  }
}
