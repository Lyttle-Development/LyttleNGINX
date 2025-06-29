import { Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReloaderService } from './reloader/reloader.service';

@Controller()
export class AppController {
  constructor(private reloader: ReloaderService) {}

  @Post('reload')
  async reload(@Res() res: Response) {
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      return res.json({ success: true });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  }
}
