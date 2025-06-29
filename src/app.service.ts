import { Injectable, OnModuleInit } from '@nestjs/common';
import { ReloaderService } from './reloader/reloader.service';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private reloader: ReloaderService) {}

  // On project initialization, reload the Nginx configuration
  async onModuleInit() {
    console.log('Initializing Nginx configuration reload...');
    const result = await this.reloader.reloadConfig();
    if (result.ok) {
      console.log('Nginx configuration reloaded successfully');
    } else {
      console.error('Failed to reload Nginx configuration:', result.error);
    }
  }
}
