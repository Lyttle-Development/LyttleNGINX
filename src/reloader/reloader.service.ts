import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NginxService } from '../nginx/nginx.service';
import { execFile } from 'child_process';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'fs/promises';
import { basename, dirname, join } from 'path';
import * as fs from 'fs';
import { CertificateService } from '../certificate/certificate.service';
import { TlsConfigService } from '../certificate/tls-config.service';
import { lookup } from 'dns/promises'; // <-- Added
import { HealthService } from '../health/health.service';
import { extractManagedPathsFromCustomCode } from '../nginx/nginx-custom-code';
import { getCertificateStorageName, parseDomains } from '../utils/domain-utils';

const NGINX_ETC_DIR = process.env['NGINX_ETC_DIR'] ?? '/etc/nginx';
const NGINX_SOURCE_DIR =
  process.env['NGINX_SOURCE_DIR'] ?? join(process.cwd(), 'nginx');
const NGINX_LOG_DIR = process.env['NGINX_LOG_DIR'] ?? '/var/log/nginx';
const NGINX_RUNTIME_DIR = join(NGINX_ETC_DIR, 'runtime');
const NGINX_RELEASES_DIR = join(NGINX_RUNTIME_DIR, 'releases');
const NGINX_CURRENT_RELEASE_LINK = join(NGINX_RUNTIME_DIR, 'current');
const NGINX_LAST_KNOWN_GOOD_LINK = join(NGINX_RUNTIME_DIR, 'last-known-good');
const NGINX_RELEASE_METADATA_FILE = 'lyttle-nginx-release.json';
const RELEASE_RETENTION_COUNT = 5;

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
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // reload interval: every 5 minutes
  private readonly intervalMs = 5 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private nginx: NginxService,
    private certificate: CertificateService,
    private tlsConfig: TlsConfigService,
    private healthService: HealthService,
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
      this.logger.log('Starting staged nginx reload process...');

      this.logger.log(`Ensuring ${NGINX_LOG_DIR} exists...`);
      await mkdir(NGINX_LOG_DIR, { recursive: true });

      await this.ensureRuntimeLayout();

      // Step 1: Fetch proxy entries and ensure any required directories exist
      this.logger.log('Fetching proxy entries from database...');
      const entries = await this.prisma.proxyEntry.findMany();
      this.logger.log(`Found ${entries.length} proxy entries.`);

      this.logger.log(
        'Ensuring directories required by proxies/redirects exist...',
      );
      await this.ensureProxyAndRedirectDirs(entries);

      // ----------- PHASE 1: Generate configs (HTTP only, as no SSL certs exist yet) -----------
      const httpOnlyRelease = await this.deployConfigSnapshot(entries, {
        phase: 'http-bootstrap',
        details: `http-only rollout for ${entries.length} proxy entr${entries.length === 1 ? 'y' : 'ies'}`,
      });

      // ----------- PHASE 2: Obtain SSL Certificates -----------
      this.logger.log('Phase 2: Ensuring SSL certificates...');


      for (const entry of entries) {
        try {
          if (!entry.ssl) continue;
          const domains = parseDomains(entry.domains, { allowWildcard: true });
          if (domains.length === 0) continue;
          const primaryDomain = domains[0];
          const certStorageName = getCertificateStorageName(primaryDomain);
          const certPath = `/etc/letsencrypt/live/${certStorageName}/fullchain.pem`;
          const keyPath = `/etc/letsencrypt/live/${certStorageName}/privkey.pem`;
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
      const sslRelease = await this.deployConfigSnapshot(entries, {
        phase: 'ssl-activation',
        details: `ssl-aware rollout for ${entries.length} proxy entr${entries.length === 1 ? 'y' : 'ies'}`,
      });

      this.logger.log(
        'Nginx config staged, validated, and activated successfully.',
      );
      this.healthService.recordConfigApplySuccess(
        `activated release ${sslRelease.releaseId} (${sslRelease.phase}); previous release ${sslRelease.previousReleaseId ?? httpOnlyRelease.previousReleaseId ?? 'none'}`,
      );
      return { ok: true };
    } catch (error: any) {
      this.logger.error(
        'Failed to reload Nginx config',
        error instanceof Error ? error.stack : String(error),
        JSON.stringify({ error, time: new Date().toISOString() }),
      );
      this.healthService.recordConfigApplyFailure(
        error.message || String(error),
      );
      return { ok: false, error: error.message || String(error) };
    }
  }

  // Helper: Generate nginx confs for all entries (auto SSL detection)
  private async generateNginxConfs(
    entries: any[],
    releasePath: string,
  ): Promise<void> {
    const confdDir = join(releasePath, 'conf.d');
    this.logger.log(`Ensuring conf.d directory exists at: ${confdDir}`);
    await mkdir(confdDir, { recursive: true });

    await this.rewriteBundledDefaultConfig(releasePath);

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
        let resolved = false;
        if (entry.type !== 'REDIRECT') {
          resolved = await isHostResolvable(upstreamHost);
        }

        this.logger.log(`Generating nginx config for entry id=${entry.id}`);
        const entryConfig = this.nginx.generateNginxConfig([entry], {
          resolved,
          htmlRoot: join(releasePath, 'html'),
        });
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
        throw error;
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
  private async ensureProxyAndRedirectDirs(entries: any[]): Promise<void> {
    this.logger.log(
      'Parsing proxy/redirect configs for required directories...',
    );
    const dirs = new Set<string>();

    for (const entry of entries) {
      try {
        if (entry.nginx_custom_code) {
          for (const path of extractManagedPathsFromCustomCode(
            entry.nginx_custom_code,
          )) {
            this.logger.log(
              `Found validated managed-path directive, will ensure directory: ${path}`,
            );
            dirs.add(path);
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
        throw error;
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

  private async ensureRuntimeLayout(): Promise<void> {
    await mkdir(NGINX_RELEASES_DIR, { recursive: true });

    let currentReleasePath = await this.getSymlinkTarget(
      NGINX_CURRENT_RELEASE_LINK,
    );
    if (!currentReleasePath) {
      currentReleasePath = await this.createBootstrapRelease();
      await this.updateSymlinkAtomically(
        NGINX_CURRENT_RELEASE_LINK,
        currentReleasePath,
      );
    }

    const lastKnownGoodPath = await this.getSymlinkTarget(
      NGINX_LAST_KNOWN_GOOD_LINK,
    );
    if (!lastKnownGoodPath) {
      await this.updateSymlinkAtomically(
        NGINX_LAST_KNOWN_GOOD_LINK,
        currentReleasePath,
      );
    }
  }

  private async createBootstrapRelease(): Promise<string> {
    const bootstrapReleasePath = join(NGINX_RELEASES_DIR, 'bootstrap');
    await rm(bootstrapReleasePath, { recursive: true, force: true });
    await this.copyDirectoryRecursive(NGINX_SOURCE_DIR, bootstrapReleasePath);
    await this.rewriteBundledDefaultConfig(bootstrapReleasePath);
    await this.writeReleaseMetadata(bootstrapReleasePath, {
      releaseId: 'bootstrap',
      phase: 'bootstrap',
      status: 'bootstrap',
      createdAt: new Date().toISOString(),
      sourceDirectory: NGINX_SOURCE_DIR,
      appliedNode: process.env['HOSTNAME'] ?? 'unknown',
      details: 'bootstrap runtime release created for nginx startup',
    });
    return bootstrapReleasePath;
  }

  private async deployConfigSnapshot(
    entries: any[],
    options: {
      phase: string;
      details: string;
    },
  ): Promise<ActivatedRelease> {
    const releaseId = this.createReleaseId(options.phase);
    const releasePath = join(NGINX_RELEASES_DIR, releaseId);
    const createdAt = new Date().toISOString();
    const previousReleasePath = await this.getSymlinkTarget(
      NGINX_CURRENT_RELEASE_LINK,
    );
    const previousReleaseId = previousReleasePath
      ? basename(previousReleasePath)
      : null;

    this.logger.log(
      `Creating staged nginx release ${releaseId} at ${releasePath}`,
    );
    await this.copyDirectoryRecursive(NGINX_SOURCE_DIR, releasePath);
    await this.generateNginxConfs(entries, releasePath);

    const validationConfigPath = await this.writeValidationConfig(releasePath);
    const validationCommand = [
      'nginx',
      '-t',
      '-c',
      validationConfigPath,
    ] as const;
    const validationOutput = await this.execCommand(
      validationCommand[0],
      validationCommand.slice(1),
    );

    await this.writeReleaseMetadata(releasePath, {
      releaseId,
      phase: options.phase,
      status: 'validated',
      createdAt,
      sourceDirectory: NGINX_SOURCE_DIR,
      appliedNode: process.env['HOSTNAME'] ?? 'unknown',
      details: options.details,
      previousReleaseId,
      validation: {
        command: validationCommand.join(' '),
        output: validationOutput,
        validatedAt: new Date().toISOString(),
      },
    });

    await this.updateSymlinkAtomically(NGINX_CURRENT_RELEASE_LINK, releasePath);

    try {
      await this.execCommand('nginx', ['-s', 'reload']);
    } catch (error) {
      await this.rollbackActivation({
        previousReleasePath,
        failedReleasePath: releasePath,
        validationOutput,
        activationError: error instanceof Error ? error.message : String(error),
      });
    }

    await this.updateSymlinkAtomically(NGINX_LAST_KNOWN_GOOD_LINK, releasePath);
    await this.writeReleaseMetadata(releasePath, {
      releaseId,
      phase: options.phase,
      status: 'active',
      createdAt,
      activatedAt: new Date().toISOString(),
      sourceDirectory: NGINX_SOURCE_DIR,
      appliedNode: process.env['HOSTNAME'] ?? 'unknown',
      details: options.details,
      previousReleaseId,
      validation: {
        command: validationCommand.join(' '),
        output: validationOutput,
      },
    });
    await this.pruneOldReleases([releasePath, previousReleasePath]);

    return {
      releaseId,
      releasePath,
      previousReleaseId,
      phase: options.phase,
      validationOutput,
    };
  }

  private async rollbackActivation(options: {
    previousReleasePath: string | null;
    failedReleasePath: string;
    validationOutput: string;
    activationError: string;
  }): Promise<never> {
    const failedReleaseId = basename(options.failedReleasePath);
    const previousReleaseId = options.previousReleasePath
      ? basename(options.previousReleasePath)
      : null;

    if (!options.previousReleasePath) {
      throw new Error(
        `Activation of release ${failedReleaseId} failed with no previous release to restore: ${options.activationError}`,
      );
    }

    this.logger.warn(
      `Activation of release ${failedReleaseId} failed; rolling back to ${previousReleaseId}`,
    );
    await this.updateSymlinkAtomically(
      NGINX_CURRENT_RELEASE_LINK,
      options.previousReleasePath,
    );

    try {
      await this.execCommand('nginx', ['-s', 'reload']);
    } catch (rollbackError) {
      throw new Error(
        `Activation of release ${failedReleaseId} failed (${options.activationError}) and rollback to ${previousReleaseId} also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }

    await this.writeReleaseMetadata(options.failedReleasePath, {
      releaseId: failedReleaseId,
      phase: 'rollback',
      status: 'rolled_back',
      createdAt: new Date().toISOString(),
      sourceDirectory: NGINX_SOURCE_DIR,
      appliedNode: process.env['HOSTNAME'] ?? 'unknown',
      previousReleaseId,
      validation: {
        output: options.validationOutput,
      },
      rollback: {
        rolledBackToReleaseId: previousReleaseId,
        rolledBackAt: new Date().toISOString(),
        activationError: options.activationError,
      },
    });

    throw new Error(
      `Activation of release ${failedReleaseId} failed and was rolled back to ${previousReleaseId}: ${options.activationError}`,
    );
  }

  private async writeValidationConfig(releasePath: string): Promise<string> {
    const validationConfigPath = join(releasePath, '.validation-nginx.conf');
    const bundledConfig = await readFile(
      join(releasePath, 'nginx.conf'),
      'utf8',
    );
    const validationConfig = bundledConfig
      .replace(
        /^pid\s+.*;$/m,
        `pid ${join(releasePath, '.validation-nginx.pid')};`,
      )
      .replaceAll('/etc/nginx/mime.types', join(releasePath, 'mime.types'))
      .replaceAll(
        '/etc/nginx/runtime/current/conf.d/*.conf',
        `${join(releasePath, 'conf.d')}/*.conf`,
      )
      .replaceAll('/etc/nginx/html', join(releasePath, 'html'));

    await writeFile(validationConfigPath, validationConfig, 'utf8');
    return validationConfigPath;
  }

  private async rewriteBundledDefaultConfig(
    releasePath: string,
  ): Promise<void> {
    const defaultConfPath = join(releasePath, 'conf.d', 'default.conf');
    if (!(await this.pathExists(defaultConfPath))) {
      return;
    }

    const rewritten = (await readFile(defaultConfPath, 'utf8'))
      .replaceAll('/etc/nginx/html', join(releasePath, 'html'))
      .replaceAll('/errors/50x.html', '/errors/5xx.html');
    await writeFile(defaultConfPath, rewritten, 'utf8');
  }

  private async writeReleaseMetadata(
    releasePath: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeFile(
      join(releasePath, NGINX_RELEASE_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    );
  }

  private async updateSymlinkAtomically(
    linkPath: string,
    targetPath: string,
  ): Promise<void> {
    await mkdir(dirname(linkPath), { recursive: true });
    const tempLinkPath = `${linkPath}.tmp-${Date.now()}`;
    await rm(tempLinkPath, { force: true });
    await symlink(targetPath, tempLinkPath);
    await rename(tempLinkPath, linkPath);
  }

  private async getSymlinkTarget(linkPath: string): Promise<string | null> {
    try {
      return await readlink(linkPath);
    } catch (error) {
      if (
        ['ENOENT', 'EINVAL'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        return null;
      }
      throw error;
    }
  }

  private createReleaseId(phase: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const normalizedPhase = phase.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    return `${timestamp}-${normalizedPhase}`;
  }

  private async pruneOldReleases(
    retainedReleasePaths: Array<string | null>,
  ): Promise<void> {
    const lastKnownGoodPath = await this.getSymlinkTarget(
      NGINX_LAST_KNOWN_GOOD_LINK,
    );
    const protectedPaths = new Set(
      [...retainedReleasePaths, lastKnownGoodPath]
        .filter((value): value is string => Boolean(value))
        .map((value) => value),
    );

    const releaseNames = await readdir(NGINX_RELEASES_DIR);
    const releases = await Promise.all(
      releaseNames.map(async (releaseName) => {
        const releasePath = join(NGINX_RELEASES_DIR, releaseName);
        const releaseStat = await stat(releasePath);
        return {
          releaseName,
          releasePath,
          modifiedAt: releaseStat.mtimeMs,
        };
      }),
    );

    const staleReleases = releases
      .filter(
        (release) =>
          release.releaseName !== 'bootstrap' &&
          !protectedPaths.has(release.releasePath),
      )
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(RELEASE_RETENTION_COUNT);

    await Promise.all(
      staleReleases.map(async (release) => {
        this.logger.log(`Pruning stale nginx release ${release.releaseName}`);
        await rm(release.releasePath, { recursive: true, force: true });
      }),
    );
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private execCommand(command: string, args: string[]): Promise<string> {
    this.logger.log(`Executing command: ${command} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      execFile(command, args, (err, stdout, stderr) => {
        if (err) {
          this.logger.error(
            `Command failed: ${command} ${args.join(' ')}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`,
          );
          return reject(new Error(stderr || stdout || err.message));
        }
        if (stdout) this.logger.log(`Command stdout: ${stdout}`);
        if (stderr) this.logger.log(`Command stderr: ${stderr}`);
        resolve([stdout, stderr].filter(Boolean).join('\n').trim());
      });
    });
  }
}

type ActivatedRelease = {
  releaseId: string;
  releasePath: string;
  previousReleaseId: string | null;
  phase: string;
  validationOutput: string;
};
