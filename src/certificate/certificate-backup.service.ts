import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import {
  getCertificateStorageName,
  hashDomains,
  joinDomains,
  normalizeDomains,
  parseDomains,
} from '../utils/domain-utils';

@Injectable()
export class CertificateBackupService {
  private readonly logger = new Logger(CertificateBackupService.name);
  private readonly backupDir = process.env.BACKUP_DIR || '/tmp/cert-backups';

  constructor(private prisma: PrismaService) {}

  async createBackup(): Promise<{ filename: string; path: string }> {
    this.logger.log('[Backup] Creating certificate backup...');

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `certificates-backup-${timestamp}.zip`;
    const filepath = path.join(this.backupDir, filename);

    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        this.logger.log(
          `[Backup] Created backup: ${filename} (${archive.pointer()} bytes)`,
        );
        resolve({ filename, path: filepath });
      });

      archive.on('error', (err) => {
        this.logger.error('[Backup] Failed to create backup', err);
        reject(err);
      });

      archive.pipe(output);

      // Add database export
      this.prisma.certificate
        .findMany()
        .then((certificates) => {
          const data = JSON.stringify(certificates, null, 2);
          archive.append(data, { name: 'certificates.json' });

          // Add individual certificate files
          certificates.forEach((cert) => {
            const domains = parseDomains(cert.domains, { allowWildcard: true });
            const prefix = `certs/${getCertificateStorageName(domains[0])}`;

            archive.append(cert.certPem, { name: `${prefix}/fullchain.pem` });
            archive.append(cert.keyPem, { name: `${prefix}/privkey.pem` });
          });

          // Add metadata
          const metadata = {
            exportDate: new Date().toISOString(),
            totalCertificates: certificates.length,
            version: '1.0',
          };
          archive.append(JSON.stringify(metadata, null, 2), {
            name: 'metadata.json',
          });

          archive.finalize();
        })
        .catch(reject);
    });
  }

  async exportCertificate(
    id: string,
  ): Promise<{ certPem: string; keyPem: string; domains: string[] }> {
    this.logger.log(`[Export] Exporting certificate: ${id}`);

    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) {
      throw new Error(`Certificate not found: ${id}`);
    }

    return {
      certPem: cert.certPem,
      keyPem: cert.keyPem,
      domains: parseDomains(cert.domains, { allowWildcard: true }),
    };
  }

  async importCertificates(
    data: Array<{
      domains: string[];
      certPem: string;
      keyPem: string;
      expiresAt: Date;
      issuedAt: Date;
    }>,
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    this.logger.log(`[Import] Importing ${data.length} certificates...`);

    const results = { imported: 0, skipped: 0, errors: 0 };

    for (const cert of data) {
      try {
        const normalizedDomains = normalizeDomains(cert.domains, {
          allowWildcard: true,
        });

        // Check if certificate already exists
        const domainsStr = joinDomains(normalizedDomains, {
          allowWildcard: true,
        });
        const existing = await this.prisma.certificate.findFirst({
          where: { domains: domainsStr },
        });

        if (existing) {
          this.logger.log(
            `[Import] Skipping existing cert: ${normalizedDomains[0]}`,
          );
          results.skipped++;
          continue;
        }

        // Import certificate
        await this.prisma.certificate.create({
          data: {
            domains: domainsStr,
            domainsHash: hashDomains(normalizedDomains, {
              allowWildcard: true,
            }),
            certPem: cert.certPem,
            keyPem: cert.keyPem,
            expiresAt: new Date(cert.expiresAt),
            issuedAt: new Date(cert.issuedAt),
            lastUsedAt: new Date(),
            isOrphaned: false,
          },
        });

        this.logger.log(`[Import] Imported cert: ${normalizedDomains[0]}`);
        results.imported++;
      } catch (error) {
        this.logger.error(
          `[Import] Failed to import cert: ${cert.domains[0]}`,
          error instanceof Error ? error.stack : String(error),
        );
        results.errors++;
      }
    }

    this.logger.log(
      `[Import] Complete. Imported: ${results.imported}, Skipped: ${results.skipped}, Errors: ${results.errors}`,
    );
    return results;
  }

  async listBackups(): Promise<
    Array<{ filename: string; size: number; created: Date }>
  > {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    const backups = files
      .filter((f) => f.endsWith('.zip'))
      .map((filename) => {
        const filepath = path.join(this.backupDir, filename);
        const stats = fs.statSync(filepath);
        return {
          filename,
          size: stats.size,
          created: stats.birthtime,
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());

    return backups;
  }

  async getBackupStream(filename: string): Promise<Readable> {
    const filepath = path.join(this.backupDir, filename);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Backup file not found: ${filename}`);
    }
    return fs.createReadStream(filepath);
  }

  async deleteBackup(filename: string): Promise<void> {
    const filepath = path.join(this.backupDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      this.logger.log(`[Backup] Deleted: ${filename}`);
    }
  }
}
