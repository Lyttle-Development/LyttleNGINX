import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ReloaderService } from './reloader/reloader.service';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(ReloaderService.name);

  constructor(private reloader: ReloaderService) {}

  // On project initialization, reload the Nginx configuration
  async onModuleInit() {
    this.logger.log('Initializing Nginx configuration reload...');
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      this.logger.log('Nginx configuration reloaded successfully');
    } else {
      this.logger.error('Failed to reload Nginx configuration:', result.error);
    }
  }
}
