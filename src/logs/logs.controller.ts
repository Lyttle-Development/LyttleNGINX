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
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @UseGuards(ApiKeyGuard)
  @Audit({ action: 'logs.read' })
  getLogs(@Query('count', ParseIntPipe) count = 100) {
    const logs = this.logsService.getLastLogs(count);
    return { logs };
  }
}
