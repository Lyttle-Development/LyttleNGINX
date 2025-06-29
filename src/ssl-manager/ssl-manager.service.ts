import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';

const exec = promisify(execCb);

const CERT_PATH = 'nginx/ssl/server.crt';
const KEY_PATH = 'nginx/ssl/server.key';
const SSL_DIR = 'nginx/ssl';

@Injectable()
export class SslManagerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SslManagerService.name);
  private interval: NodeJS.Timeout | null = null;
  // Set the renewal interval and cert valid days here:
  private readonly renewalIntervalMs = 1000 * 60 * 60 * 24; // 24 hours
  private readonly certValidDays = 30;

  async ensureValidCertificate(): Promise<boolean> {
    try {
      await mkdir(SSL_DIR, { recursive: true });
      let needsRegen = false;
      if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) {
        needsRegen = true;
      } else {
        const certStat = await stat(CERT_PATH);
        const now = Date.now();
        const maxAge = this.certValidDays * 24 * 60 * 60 * 1000;
        if (now - certStat.mtimeMs > maxAge) {
          needsRegen = true;
        }
      }
      if (needsRegen) {
        this.logger.log(
          'Generating new self-signed SSL certificate for NGINX...',
        );
        await exec(
          `openssl req -x509 -nodes -days ${this.certValidDays} -newkey rsa:2048 -keyout ${KEY_PATH} -out ${CERT_PATH} -subj "/CN=localhost"`,
        );
        this.logger.log('SSL certificate generated.');
        return true;
      }
      this.logger.log('Existing SSL certificate is valid.');
      return false;
    } catch (err) {
      this.logger.error('Failed to generate/check SSL certificate', err);
      throw err;
    }
  }

  async onModuleInit() {
    await this.ensureValidCertificate();
    this.startAutoRenew();
  }

  startAutoRenew() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(async () => {
      this.logger.log('Running scheduled SSL certificate renewal check...');
      const changed = await this.ensureValidCertificate();
      if (changed) {
        this.logger.log('SSL cert renewed, reloading nginx...');
        try {
          await exec('nginx -s reload');
          this.logger.log('Nginx reloaded successfully.');
        } catch (err) {
          this.logger.error('Failed to reload nginx after cert renewal', err);
        }
      }
    }, this.renewalIntervalMs);
  }

  onApplicationShutdown() {
    if (this.interval) clearInterval(this.interval);
  }
}
