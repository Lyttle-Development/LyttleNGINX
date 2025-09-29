import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
import * as fs from 'fs';
import { CertificateService } from '../certificate/certificate.service';
import { lookup } from 'dns/promises'; // <-- Added

const NGINX_ETC_DIR = '/etc/nginx';
const NGINX_SOURCE_DIR = join(process.cwd(), 'nginx');

// Helper function to check if host resolves
async function isHostResolvable(host: string): Promise<boolean> {
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class ReloaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReloaderService.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  // reload interval: every 5 minutes
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private nginx: NginxService,
    private certificate: CertificateService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Starting automated reloader: interval=${this.intervalMs}ms`,
    );
    // Run an immediate attempt at startup (non-blocking)
    this.runReloadSafe().catch((err) => {
      this.logger.warn(`Initial reload attempt failed: ${err?.message ?? err}`);
    });

    // Setup periodic reloads
    this.intervalHandle = setInterval(() => {
      this.runReloadSafe().catch((err) => {
        this.logger.warn(`Scheduled reload failed: ${err?.message ?? err}`);
      });
    }, this.intervalMs);
    // Unref so interval won't keep the process alive unnecessarily
    this.intervalHandle.unref?.();
  }

  async onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('Automated reloader stopped');
    }
  }

  private async runReloadSafe(): Promise<void> {
    const res = await this.reloadConfig();
    if (res.ok) {
      this.logger.log('Automated reload succeeded');
    } else {
      this.logger.warn(`Automated reload reported error: ${res.error ?? ''}`);
    }
  }

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

      // Step 4: Fetch proxy entries
      this.logger.log('Fetching proxy entries from database...');
      const entries = await this.prisma.proxyEntry.findMany();
      this.logger.log(`Found ${entries.length} proxy entries.`);

      // ----------- PHASE 1: Generate configs (HTTP only, as no SSL certs exist yet) -----------
      this.logger.log('Phase 1: Generating HTTP-only nginx configs...');
      await this.generateNginxConfs(entries);

      // Validate and reload
      this.logger.log('Validating nginx config syntax (nginx -t)...');
      await this.execShell('nginx -t');

      this.logger.log('Reloading nginx (nginx -s reload)...');
      await this.execShell('nginx -s reload');

      // ----------- PHASE 2: Obtain SSL Certificates -----------
      this.logger.log('Phase 2: Ensuring SSL certificates...');
      for (const entry of entries) {
        try {
          if (!entry.ssl) continue;
          const domains = entry.domains
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean);
          if (domains.length === 0) continue;
          const primaryDomain = domains[0];
          const certPath = `/etc/letsencrypt/live/${primaryDomain}/fullchain.pem`;
          const keyPath = `/etc/letsencrypt/live/${primaryDomain}/privkey.pem`;
          if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            this.logger.log(
              `Certificate missing for ${primaryDomain}, calling ensureCertificate`,
            );
            await this.certificate.ensureCertificate(domains);
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to ensure SSL certificate for entry id=${entry.id}`,
            error instanceof Error ? error.stack : String(error),
            JSON.stringify({
              entryId: entry.id,
              time: new Date().toISOString(),
            }),
          );
        }
      }

      // ----------- PHASE 3: Re-generate configs (now with SSL where possible) -----------
      this.logger.log('Phase 3: Generating SSL-enabled nginx configs...');
      await this.generateNginxConfs(entries);

      // Validate and reload
      this.logger.log('Validating nginx config syntax (nginx -t)...');
      await this.execShell('nginx -t');

      this.logger.log('Reloading nginx (nginx -s reload)...');
      await this.execShell('nginx -s reload');

      this.logger.log(
        'Nginx config and directories replaced/reloaded successfully.',
      );
      return { ok: true };
    } catch (error: any) {
      this.logger.error(
        'Failed to reload Nginx config',
        error instanceof Error ? error.stack : String(error),
        JSON.stringify({ error, time: new Date().toISOString() }),
      );
      return { ok: false, error: error.message || String(error) };
    }
  }

  // Helper: Generate nginx confs for all entries (auto SSL detection)
  private async generateNginxConfs(entries: any[]): Promise<void> {
    const confdDir = join(NGINX_ETC_DIR, 'conf.d');
    this.logger.log(`Ensuring conf.d directory exists at: ${confdDir}`);
    await mkdir(confdDir, { recursive: true });

    for (const entry of entries) {
      try {
        // Extract upstream host from entry.proxy_pass_host (handle http[s]://host[:port])
        let upstreamHost = entry.proxy_pass_host;
        // Only for proxy type, not redirect
        if (entry.type !== 'REDIRECT' && entry.proxy_pass_host) {
          // Example: http://srv-captain--community-v3-api:3000/
          const match = entry.proxy_pass_host.match(/^https?:\/\/([^/:]+)/);
          if (match) upstreamHost = match[1];
        }

        // Check if upstream host resolves (skip for REDIRECT type)
        let resolved = false
        if (entry.type !== 'REDIRECT') {
          resolved = await isHostResolvable(upstreamHost);
        }

        this.logger.log(`Generating nginx config for entry id=${entry.id}`);
        const entryConfig = this.nginx.generateNginxConfig([entry], resolved);
        const entryFilename = join(confdDir, `${entry.id}.conf.tmp`);
        this.logger.log(`Writing temp config file: ${entryFilename}`);
        await writeFile(entryFilename, entryConfig, { encoding: 'utf-8' });
        const finalFilename = join(confdDir, `${entry.id}.conf`);
        this.logger.log(`Renaming temp config file to final: ${finalFilename}`);
        await rename(entryFilename, finalFilename);
      } catch (error: any) {
        this.logger.error(
          `Failed to generate nginx config for entry id=${entry.id}`,
          error instanceof Error ? error.stack : String(error),
          JSON.stringify({
            entryId: entry.id,
            time: new Date().toISOString(),
          }),
        );
      }
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
          try {
            const fullPath = join(dir, file);
            const fileStat = await stat(fullPath);
            if (fileStat.isDirectory()) {
              this.logger.log(`Removing directory: ${fullPath}`);
              await rm(fullPath, { recursive: true, force: true });
            } else {
              this.logger.log(`Removing file: ${fullPath}`);
              await unlink(fullPath);
            }
          } catch (err) {
            this.logger.error(
              `Failed to remove ${file} in ${dir}`,
              err instanceof Error ? err.stack : String(err),
              JSON.stringify({
                file,
                dir,
                time: new Date().toISOString(),
              }),
            );
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
      try {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
          this.logger.log(`Recursively copying directory: ${srcPath}`);
          await this.copyDirectoryRecursive(srcPath, destPath);
        } else {
          this.logger.log(`Copying file: ${srcPath} -> ${destPath}`);
          await copyFile(srcPath, destPath);
        }
      } catch (err) {
        this.logger.error(
          `Failed to copy ${entry.name} from ${src} to ${dest}`,
          err instanceof Error ? err.stack : String(err),
          JSON.stringify({
            entryName: entry.name,
            src,
            dest,
            time: new Date().toISOString(),
          }),
        );
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
      try {
        if (entry.nginx_custom_code) {
          const rootMatches = entry.nginx_custom_code.match(/root\s+([^;]+);/g);
          const aliasMatches =
            entry.nginx_custom_code.match(/alias\s+([^;]+);/g);
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
      } catch (error: any) {
        this.logger.error(
          `Failed to parse nginx_custom_code for entry id=${entry.id}`,
          error instanceof Error ? error.stack : String(error),
          JSON.stringify({
            entryId: entry.id,
            time: new Date().toISOString(),
          }),
        );
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
