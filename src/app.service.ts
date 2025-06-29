import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ReloaderService } from './reloader/reloader.service';
import { SslService } from './ssl/ssl.service';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private reloader: ReloaderService,
    private ssl: SslService,
  ) {}

  // On project initialization, reload the Nginx configuration and start SSL renewal timer
  async onModuleInit() {
    this.logger.log('Initializing application...');
    
    // Reload Nginx configuration (which will also ensure SSL certificates exist)
    this.logger.log('Initializing Nginx configuration reload...');
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      this.logger.log('Nginx configuration reloaded successfully');
    } else {
      this.logger.error('Failed to reload Nginx configuration:', result.error);
      return;
    }

    // Start SSL certificate renewal timer
    this.logger.log('Starting SSL certificate renewal timer...');
    this.ssl.startRenewalTimer();
    this.logger.log('Application initialization completed');
  }

  // On module destruction, stop the SSL renewal timer
  onModuleDestroy() {
    this.logger.log('Stopping SSL certificate renewal timer...');
    this.ssl.stopRenewalTimer();
  }
}
