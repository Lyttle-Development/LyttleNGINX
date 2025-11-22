import { Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReloaderService } from './reloader/reloader.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Controller()
export class AppController {
  constructor(private reloader: ReloaderService) {}

  @Post('reload')
  @UseGuards(JwtAuthGuard)
  async reload(@Res() res: Response) {
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      return res.json({ success: true });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  }
}
