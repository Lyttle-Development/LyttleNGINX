import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NginxService } from '../nginx/nginx.service';
import { exec } from 'child_process';
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { join } from 'path';

const NGINX_ETC_DIR = '/etc/nginx';
const NGINX_SOURCE_DIR = join(process.cwd(), 'nginx');

@Injectable()
export class ReloaderService {
  private readonly logger = new Logger(ReloaderService.name);

  constructor(
    private prisma: PrismaService,
    private nginx: NginxService,
  ) {}

  async reloadConfig(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Step 1: Remove all content from /etc/nginx
      await this.clearDirectory(NGINX_ETC_DIR, false);

      // Step 2: Copy full /nginx (project) to /etc/nginx
      await this.copyDirectoryRecursive(NGINX_SOURCE_DIR, NGINX_ETC_DIR);

      // Step 3: Ensure any directories required by proxy/redirect configs exist
      await this.ensureProxyAndRedirectDirs();

      // Step 4: Generate per-proxy/entry config files in the right place
      const entries = await this.prisma.proxyEntry.findMany();

      // Assume conf.d is used for dynamic proxy entries
      const confdDir = join(NGINX_ETC_DIR, 'conf.d');
      await mkdir(confdDir, { recursive: true });

      for (const entry of entries) {
        const entryConfig = this.nginx.generateNginxConfig([entry]);
        const entryFilename = join(confdDir, `${entry.id}.conf.tmp`);
        await writeFile(entryFilename, entryConfig, { encoding: 'utf-8' });
        const finalFilename = join(confdDir, `${entry.id}.conf`);
        await rename(entryFilename, finalFilename);
      }

      // Step 5: Validate the total config before reloading
      await this.execShell('nginx -t');

      // Step 6: Reload NGINX
      await this.execShell('nginx -s reload');

      this.logger.log(
        'Nginx config and directories replaced/reloaded successfully.',
      );
      return { ok: true };
    } catch (error: any) {
      this.logger.error('Failed to reload Nginx config', error);
      return { ok: false, error: error.message || String(error) };
    }
  }

  // Recursively remove all contents from a directory (but not the directory itself)
  private async clearDirectory(dir: string, removeSelf = false): Promise<void> {
    try {
      const files = await readdir(dir);
      await Promise.all(
        files.map(async (file) => {
          const fullPath = join(dir, file);
          const fileStat = await stat(fullPath);
          if (fileStat.isDirectory()) {
            await rm(fullPath, { recursive: true, force: true });
          } else {
            await unlink(fullPath);
          }
        }),
      );
      if (removeSelf) {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (err) {
      // If directory does not exist, ignore
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  // Recursively copy one directory to another, preserving structure
  private async copyDirectoryRecursive(
    src: string,
    dest: string,
  ): Promise<void> {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }

  // Ensure directories required by proxies/redirects exist
  // Since your ProxyEntry type does not have targetPath, we try to infer possible directories
  // by parsing proxy_pass_host or nginx_custom_code for likely paths
  private async ensureProxyAndRedirectDirs(): Promise<void> {
    const entries = await this.prisma.proxyEntry.findMany();
    const dirs = new Set<string>();

    for (const entry of entries) {
      // Try to extract directory from nginx_custom_code if it contains root or alias directives
      if (entry.nginx_custom_code) {
        const rootMatches = entry.nginx_custom_code.match(/root\s+([^;]+);/g);
        const aliasMatches = entry.nginx_custom_code.match(/alias\s+([^;]+);/g);
        if (rootMatches) {
          rootMatches.forEach((m) => {
            const path = m
              .replace(/root\s+/, '')
              .replace(/;/, '')
              .trim();
            dirs.add(path);
          });
        }
        if (aliasMatches) {
          aliasMatches.forEach((m) => {
            const path = m
              .replace(/alias\s+/, '')
              .replace(/;/, '')
              .trim();
            dirs.add(path);
          });
        }
      }

      // You can add more parsing here for other fields if needed
    }
 
    for (const dir of dirs) {
      try {
        await mkdir(dir, { recursive: true });
      } catch (e) {
        this.logger.warn(`Failed to ensure directory: ${dir}`, e);
      }
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
