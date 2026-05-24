import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ReloaderService } from './reloader/reloader.service';
import { AuthorizeAdmin } from './auth/decorators/authorize.decorator';
import { ApiKeyGuard } from './auth/guards/api-key.guard';
import { Audit } from './audit/decorators/audit.decorator';

@Controller()
export class AppController {
  constructor(private reloader: ReloaderService) {}

  @Post('reload')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'config.reload.local' })
  async reload(@Res() res: Response) {
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      return res.json({ success: true });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  }
}
