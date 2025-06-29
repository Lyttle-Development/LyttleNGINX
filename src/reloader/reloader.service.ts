import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NginxService } from '../nginx/nginx.service';
import { exec } from 'child_process';
import { rename, writeFile } from 'fs/promises';

const NGINX_CONFIG_PATH =
  process.env.NGINX_CONFIG_PATH || '/etc/nginx/conf.d/default.conf';

@Injectable()
export class ReloaderService {
  private readonly logger = new Logger(ReloaderService.name);

  constructor(
    private prisma: PrismaService,
    private nginx: NginxService,
  ) {}

  async reloadConfig(): Promise<{ ok: boolean; error?: string }> {
    try {
      const entries = await this.prisma.proxyEntry.findMany();
      const config = this.nginx.generateNginxConfig(entries);

      // Write to a temp file first
      const tempPath = NGINX_CONFIG_PATH + '.tmp';
      await writeFile(tempPath, config, { encoding: 'utf-8' });

      // Validate config
      await this.execShell(`nginx -t -c ${tempPath}`);

      // Atomically move into place
      await rename(tempPath, NGINX_CONFIG_PATH);

      // Reload NGINX
      await this.execShell('nginx -s reload');

      this.logger.log('Nginx config reloaded successfully');
      return { ok: true };
    } catch (error: any) {
      this.logger.error('Failed to reload Nginx config', error);
      return { ok: false, error: error.message || String(error) };
    }
  }

  private execShell(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          this.logger.error(
            `Command failed: ${cmd}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`,
          );
          return reject(new Error(stderr || stdout || err.message));
        }
        resolve();
      });
    });
  }
}
