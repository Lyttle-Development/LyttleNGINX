import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NginxService } from '../nginx/nginx.service';
import { SslService } from '../ssl/ssl.service';
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
    private ssl: SslService,
  ) {}

  async reloadConfig(): Promise<{ ok: boolean; error?: string }> {
    try {
      this.logger.log('Starting nginx reload process...');
      // Step 1: Remove all content from /etc/nginx
      this.logger.log(`Clearing directory: ${NGINX_ETC_DIR}`);
      await this.clearDirectory(NGINX_ETC_DIR, false);

      // Step 2: Copy full /nginx (project) to /etc/nginx
      this.logger.log(`Copying from ${NGINX_SOURCE_DIR} to ${NGINX_ETC_DIR}`);
      await this.copyDirectoryRecursive(NGINX_SOURCE_DIR, NGINX_ETC_DIR);

      this.logger.log('Ensuring /var/log/nginx exists...');
      await mkdir('/var/log/nginx', { recursive: true });

      // Step 3: Ensure any directories required by proxy/redirect configs exist
      this.logger.log(
        'Ensuring directories required by proxies/redirects exist...',
      );
      await this.ensureProxyAndRedirectDirs();

      // Step 3.5: Ensure SSL certificates exist
      this.logger.log('Ensuring SSL certificates exist...');
      await this.ssl.ensureSslCertificates();

      // Step 4: Generate per-proxy/entry config files in the right place
      this.logger.log('Fetching proxy entries from database...');
      const entries = await this.prisma.proxyEntry.findMany();
      this.logger.log(`Found ${entries.length} proxy entries.`);

      // Assume conf.d is used for dynamic proxy entries
      const confdDir = join(NGINX_ETC_DIR, 'conf.d');
      this.logger.log(`Ensuring conf.d directory exists at: ${confdDir}`);
      await mkdir(confdDir, { recursive: true });

      for (const entry of entries) {
        this.logger.log(`Generating nginx config for entry id=${entry.id}`);
        const entryConfig = this.nginx.generateNginxConfig([entry]);
        const entryFilename = join(confdDir, `${entry.id}.conf.tmp`);
        this.logger.log(`Writing temp config file: ${entryFilename}`);
        await writeFile(entryFilename, entryConfig, { encoding: 'utf-8' });
        const finalFilename = join(confdDir, `${entry.id}.conf`);
        this.logger.log(`Renaming temp config file to final: ${finalFilename}`);
        await rename(entryFilename, finalFilename);
      }

      // Step 5: Validate the total config before reloading
      this.logger.log('Validating nginx config syntax (nginx -t)...');
      await this.execShell('nginx -t');

      // Step 6: Reload NGINX
      this.logger.log('Reloading nginx (nginx -s reload)...');
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
      this.logger.log(`Reading directory for clearance: ${dir}`);
      const files = await readdir(dir);
      this.logger.log(`Found ${files.length} items in ${dir} to remove.`);
      await Promise.all(
        files.map(async (file) => {
          const fullPath = join(dir, file);
          const fileStat = await stat(fullPath);
          if (fileStat.isDirectory()) {
            this.logger.log(`Removing directory: ${fullPath}`);
            await rm(fullPath, { recursive: true, force: true });
          } else {
            this.logger.log(`Removing file: ${fullPath}`);
            await unlink(fullPath);
          }
        }),
      );
      if (removeSelf) {
        this.logger.log(`Removing directory itself: ${dir}`);
        await rm(dir, { recursive: true, force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`Error clearing directory: ${dir}`, err);
        throw err;
      } else {
        this.logger.log(`Directory does not exist (ignored): ${dir}`);
      }
    }
  }

  // Recursively copy one directory to another, preserving structure
  private async copyDirectoryRecursive(
    src: string,
    dest: string,
  ): Promise<void> {
    this.logger.log(`Copying directory: ${src} -> ${dest}`);
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    this.logger.log(`Found ${entries.length} entries in ${src}`);
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        this.logger.log(`Recursively copying directory: ${srcPath}`);
        await this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        this.logger.log(`Copying file: ${srcPath} -> ${destPath}`);
        await copyFile(srcPath, destPath);
      }
    }
  }

  // Ensure directories required by proxies/redirects exist
  private async ensureProxyAndRedirectDirs(): Promise<void> {
    this.logger.log(
      'Parsing proxy/redirect configs for required directories...',
    );
    const entries = await this.prisma.proxyEntry.findMany();
    const dirs = new Set<string>();

    for (const entry of entries) {
      if (entry.nginx_custom_code) {
        const rootMatches = entry.nginx_custom_code.match(/root\s+([^;]+);/g);
        const aliasMatches = entry.nginx_custom_code.match(/alias\s+([^;]+);/g);
        if (rootMatches) {
          rootMatches.forEach((m) => {
            const path = m
              .replace(/root\s+/, '')
              .replace(/;/, '')
              .trim();
            this.logger.log(
              `Found root directive, will ensure directory: ${path}`,
            );
            dirs.add(path);
          });
        }
        if (aliasMatches) {
          aliasMatches.forEach((m) => {
            const path = m
              .replace(/alias\s+/, '')
              .replace(/;/, '')
              .trim();
            this.logger.log(
              `Found alias directive, will ensure directory: ${path}`,
            );
            dirs.add(path);
          });
        }
      }
    }

    for (const dir of dirs) {
      try {
        this.logger.log(`Ensuring directory exists: ${dir}`);
        await mkdir(dir, { recursive: true });
      } catch (e) {
        this.logger.warn(`Failed to ensure directory: ${dir}`, e);
      }
    }
  }

  private execShell(cmd: string): Promise<void> {
    this.logger.log(`Executing shell command: ${cmd}`);
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          this.logger.error(
            `Command failed: ${cmd}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`,
          );
          return reject(new Error(stderr || stdout || err.message));
        }
        if (stdout) this.logger.log(`Command stdout: ${stdout}`);
        if (stderr) this.logger.log(`Command stderr: ${stderr}`);
        resolve();
      });
    });
  }
}
