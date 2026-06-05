import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  getCertificateStorageName,
  hashDomains,
  joinDomains,
  normalizeDomains,
  parseDomains,
} from '../utils/domain-utils';
import { PrivateKeyEncryptionService } from './private-key-encryption.service';

const BACKUP_ENVELOPE_FORMAT = 'lyttle-backup-envelope/v1';
const BACKUP_PAYLOAD_FORMAT = 'lyttle-backup-payload/v1';
const BACKUP_MANIFEST_FORMAT = 'lyttle-backup-manifest/v1';
const BACKUP_VERSION = '2.0';
const DEVELOPMENT_FALLBACK_BACKUP_KEY =
  'lyttle-nginx-development-only-backup-key';
const CERTIFICATES_ENTRY_PATH = 'certificates.json';
const METADATA_ENTRY_PATH = 'metadata.json';
const BACKUP_FILENAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:lyttlebackup|zip)$/;

type BackupFileEntry = {
  path: string;
  contentType: 'application/json' | 'application/x-pem-file';
  content: string;
};

type BackupManifestEntry = {
  path: string;
  contentType: BackupFileEntry['contentType'];
  bytes: number;
  sha256: string;
};

type BackupManifest = {
  format: typeof BACKUP_MANIFEST_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  certificateCount: number;
  encryptionKeyVersion: string;
  entries: BackupManifestEntry[];
};

type BackupPayload = {
  format: typeof BACKUP_PAYLOAD_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  entries: BackupFileEntry[];
};

type BackupEnvelope = {
  format: typeof BACKUP_ENVELOPE_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  manifest: BackupManifest;
  manifestSignature: string;
  encryption: {
    scheme: 'aes-256-gcm';
    keyVersion: string;
    keyId: string;
    iv: string;
    authTag: string;
    aad: string;
  };
  payload: string;
};

type ImportCertificateRecord = {
  domains: string[];
  certPem: string;
  keyPem: string;
  expiresAt: string | Date;
  issuedAt: string | Date;
};

type NormalizedImportCertificateRecord = {
  domains: string[];
  certPem: string;
  keyPem: string;
  expiresAt: Date;
  issuedAt: Date;
};

type BackupProtectionConfig = {
  key: Buffer;
  keyVersion: string;
  keyId: string;
};

@Injectable()
export class CertificateBackupService {
  private readonly logger = new Logger(CertificateBackupService.name);
  private readonly backupDir = process.env.BACKUP_DIR || '/tmp/cert-backups';

  constructor(
    private prisma: PrismaService,
    private readonly privateKeyEncryption: PrivateKeyEncryptionService = new PrivateKeyEncryptionService(),
  ) {}

  private decryptCertificateKey(cert: {
    keyPem: string;
    keyEncryption?: unknown;
    domainsHash: string;
  }) {
    return this.privateKeyEncryption.decryptPrivateKey(
      cert.keyPem,
      cert.keyEncryption ?? null,
      {
        scope: 'certificate',
        domainsHash: cert.domainsHash,
      },
    );
  }

  async createBackup(): Promise<{ filename: string; path: string }> {
    this.logger.log('[Backup] Creating encrypted certificate backup...');
    this.ensureBackupDirectory();

    const createdAt = new Date().toISOString();
    const timestamp = createdAt.replace(/[:.]/g, '-');
    const filename = `certificates-backup-${timestamp}.lyttlebackup`;
    const filepath = path.join(this.backupDir, filename);
    const protection = this.getBackupProtectionConfig();

    const certificates = await this.prisma.certificate.findMany();
    const exportCertificates = certificates.map((cert) => ({
      domains: parseDomains(cert.domains, { allowWildcard: true }),
      certPem: cert.certPem,
      keyPem: this.decryptCertificateKey(cert),
      issuedAt: new Date(cert.issuedAt).toISOString(),
      expiresAt: new Date(cert.expiresAt).toISOString(),
    }));

    const metadata = {
      exportDate: createdAt,
      totalCertificates: exportCertificates.length,
      version: BACKUP_VERSION,
      format: BACKUP_ENVELOPE_FORMAT,
      encrypted: true,
      integrity: 'manifest+hmac+aes-256-gcm',
    };

    const entries: BackupFileEntry[] = [
      {
        path: CERTIFICATES_ENTRY_PATH,
        contentType: 'application/json',
        content: JSON.stringify(exportCertificates, null, 2),
      },
      {
        path: METADATA_ENTRY_PATH,
        contentType: 'application/json',
        content: JSON.stringify(metadata, null, 2),
      },
    ];

    for (const cert of exportCertificates) {
      const prefix = `certs/${getCertificateStorageName(cert.domains[0])}`;
      entries.push(
        {
          path: `${prefix}/fullchain.pem`,
          contentType: 'application/x-pem-file',
          content: cert.certPem,
        },
        {
          path: `${prefix}/privkey.pem`,
          contentType: 'application/x-pem-file',
          content: cert.keyPem,
        },
      );
    }

    const payload: BackupPayload = {
      format: BACKUP_PAYLOAD_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      entries,
    };

    const manifest: BackupManifest = {
      format: BACKUP_MANIFEST_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      certificateCount: exportCertificates.length,
      encryptionKeyVersion: protection.keyVersion,
      entries: entries.map((entry) => ({
        path: entry.path,
        contentType: entry.contentType,
        bytes: Buffer.byteLength(entry.content, 'utf8'),
        sha256: this.sha256(entry.content),
      })),
    };

    const envelope = this.encryptBackupPayload(payload, manifest, protection);
    fs.writeFileSync(filepath, JSON.stringify(envelope, null, 2), 'utf8');

    this.logger.log(
      `[Backup] Created encrypted backup: ${filename} (${fs.statSync(filepath).size} bytes)`,
    );

    return { filename, path: filepath };
  }

  async exportCertificate(
    id: string,
  ): Promise<{ certPem: string; keyPem: string; domains: string[] }> {
    this.logger.log(`[Export] Exporting certificate: ${id}`);

    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) {
      throw new NotFoundException(`Certificate not found: ${id}`);
    }

    return {
      certPem: cert.certPem,
      keyPem: this.decryptCertificateKey(cert),
      domains: parseDomains(cert.domains, { allowWildcard: true }),
    };
  }

  async importCertificates(
    data: ImportCertificateRecord[],
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    if (!Array.isArray(data)) {
      throw new BadRequestException(
        'Import payload must contain a certificates array',
      );
    }

    this.logger.log(`[Import] Importing ${data.length} certificates...`);

    const results = { imported: 0, skipped: 0, errors: 0 };

    for (const [index, cert] of data.entries()) {
      try {
        const validated = this.validateImportRecord(cert, index);
        const normalizedDomains = validated.domains;
        const domainsHash = hashDomains(normalizedDomains, {
          allowWildcard: true,
        });
        const encryptedKey = this.privateKeyEncryption.encryptPrivateKey(
          validated.keyPem,
          {
            scope: 'certificate',
            domainsHash,
          },
        );

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
            domainsHash,
            certPem: validated.certPem,
            keyPem: encryptedKey.keyPem,
            keyEncryption: encryptedKey.keyEncryption ?? undefined,
            expiresAt: validated.expiresAt,
            issuedAt: validated.issuedAt,
            lastUsedAt: new Date(),
            isOrphaned: false,
          },
        } as any);

        this.logger.log(`[Import] Imported cert: ${normalizedDomains[0]}`);
        results.imported++;
      } catch (error) {
        const label =
          cert && typeof cert === 'object' && Array.isArray(cert.domains)
            ? String(cert.domains[0] ?? `entry-${index + 1}`)
            : `entry-${index + 1}`;
        this.logger.error(
          `[Import] Failed to import cert: ${label}`,
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

  async verifyBackup(filename: string): Promise<{
    verified: true;
    filename: string;
    createdAt: string;
    version: string;
    certificateCount: number;
    entryCount: number;
    keyVersion: string;
  }> {
    const { envelope, payload } = this.readAndVerifyBackup(filename);

    return {
      verified: true,
      filename: this.sanitizeBackupFilename(filename),
      createdAt: envelope.createdAt,
      version: envelope.version,
      certificateCount: envelope.manifest.certificateCount,
      entryCount: payload.entries.length,
      keyVersion: envelope.encryption.keyVersion,
    };
  }

  async restoreBackup(
    filename: string,
  ): Promise<
    {
      imported: number;
      skipped: number;
      errors: number;
    } & {
      verifiedBackup: Awaited<ReturnType<CertificateBackupService['verifyBackup']>>;
    }
  > {
    const verification = await this.verifyBackup(filename);
    const { payload } = this.readAndVerifyBackup(filename);
    const certificatesEntry = payload.entries.find(
      (entry) => entry.path === CERTIFICATES_ENTRY_PATH,
    );

    if (!certificatesEntry) {
      throw new BadRequestException(
        'Backup payload is missing certificates.json',
      );
    }

    let certificates: ImportCertificateRecord[];
    try {
      const parsed = JSON.parse(certificatesEntry.content) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('certificates.json must contain an array');
      }
      certificates = parsed as ImportCertificateRecord[];
    } catch (error) {
      throw new BadRequestException(
        `Backup payload contains invalid certificates.json content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const results = await this.importCertificates(certificates);
    return {
      ...results,
      verifiedBackup: verification,
    };
  }

  async listBackups(): Promise<
    Array<{ filename: string; size: number; created: Date }>
  > {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir);
    const backups = files
      .filter((f) => BACKUP_FILENAME_PATTERN.test(f))
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
    const filepath = this.resolveBackupFilePath(filename);
    if (!fs.existsSync(filepath)) {
      throw new NotFoundException(`Backup file not found: ${filename}`);
    }
    return fs.createReadStream(filepath);
  }

  async deleteBackup(filename: string): Promise<void> {
    const filepath = this.resolveBackupFilePath(filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      this.logger.log(`[Backup] Deleted: ${filename}`);
    }
  }

  private ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private getBackupProtectionConfig(): BackupProtectionConfig {
    const keyVersion =
      process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim() || 'v1';
    const keyMaterial =
      process.env.BACKUP_ENCRYPTION_KEY?.trim() ||
      this.resolveDevelopmentFallbackBackupKey();

    if (!process.env.BACKUP_ENCRYPTION_KEY?.trim() && process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'BACKUP_ENCRYPTION_KEY must be configured in production before backup, verify, or restore operations can run',
      );
    }

    return {
      key: this.deriveSymmetricKey(keyMaterial),
      keyVersion,
      keyId: `backup:${keyVersion}`,
    };
  }

  private resolveDevelopmentFallbackBackupKey(): string {
    return DEVELOPMENT_FALLBACK_BACKUP_KEY;
  }

  private deriveSymmetricKey(rawSecret: string): Buffer {
    const trimmed = rawSecret.trim();

    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    const compact = trimmed.replace(/\s+/g, '');
    const decoded = Buffer.from(compact, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }

    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  }

  private encryptBackupPayload(
    payload: BackupPayload,
    manifest: BackupManifest,
    protection: BackupProtectionConfig,
  ): BackupEnvelope {
    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const aad = Buffer.from(
      JSON.stringify({
        format: BACKUP_ENVELOPE_FORMAT,
        version: BACKUP_VERSION,
        keyVersion: protection.keyVersion,
      }),
      'utf8',
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', protection.key, iv);
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([
      cipher.update(payloadBuffer),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      format: BACKUP_ENVELOPE_FORMAT,
      version: BACKUP_VERSION,
      createdAt: manifest.createdAt,
      manifest,
      manifestSignature: this.signManifest(manifest, protection.key),
      encryption: {
        scheme: 'aes-256-gcm',
        keyVersion: protection.keyVersion,
        keyId: protection.keyId,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        aad: aad.toString('base64'),
      },
      payload: ciphertext.toString('base64'),
    };
  }

  private readAndVerifyBackup(filename: string): {
    envelope: BackupEnvelope;
    payload: BackupPayload;
  } {
    const filepath = this.resolveBackupFilePath(filename);
    if (!fs.existsSync(filepath)) {
      throw new NotFoundException(`Backup file not found: ${filename}`);
    }

    if (filename.endsWith('.zip')) {
      throw new BadRequestException(
        'Legacy plaintext .zip backups cannot be verified or restored by the current hardened backup flow; create a new encrypted backup first',
      );
    }

    const protection = this.getBackupProtectionConfig();

    let envelope: BackupEnvelope;
    try {
      envelope = JSON.parse(fs.readFileSync(filepath, 'utf8')) as BackupEnvelope;
    } catch (error) {
      throw new BadRequestException(
        `Backup file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (envelope.format !== BACKUP_ENVELOPE_FORMAT) {
      throw new BadRequestException(
        `Unsupported backup format: ${String((envelope as Partial<BackupEnvelope>).format ?? 'unknown')}`,
      );
    }

    const expectedSignature = this.signManifest(envelope.manifest, protection.key);
    if (!this.constantTimeEquals(expectedSignature, envelope.manifestSignature)) {
      throw new BadRequestException(
        'Backup manifest signature verification failed',
      );
    }

    let payload: BackupPayload;
    try {
      const decipher = crypto.createDecipheriv(
        envelope.encryption.scheme,
        protection.key,
        Buffer.from(envelope.encryption.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(envelope.encryption.aad, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.payload, 'base64')),
        decipher.final(),
      ]);
      payload = JSON.parse(plaintext.toString('utf8')) as BackupPayload;
    } catch (error) {
      throw new BadRequestException(
        `Backup decryption failed or the payload has been tampered with: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (payload.format !== BACKUP_PAYLOAD_FORMAT) {
      throw new BadRequestException(
        `Unsupported decrypted backup payload format: ${String((payload as Partial<BackupPayload>).format ?? 'unknown')}`,
      );
    }

    if (payload.entries.length !== envelope.manifest.entries.length) {
      throw new BadRequestException(
        'Backup payload entry count does not match the signed manifest',
      );
    }

    for (const manifestEntry of envelope.manifest.entries) {
      const payloadEntry = payload.entries.find(
        (entry) => entry.path === manifestEntry.path,
      );

      if (!payloadEntry) {
        throw new BadRequestException(
          `Backup payload is missing signed entry ${manifestEntry.path}`,
        );
      }

      if (payloadEntry.contentType !== manifestEntry.contentType) {
        throw new BadRequestException(
          `Backup entry ${manifestEntry.path} content type does not match the signed manifest`,
        );
      }

      if (Buffer.byteLength(payloadEntry.content, 'utf8') !== manifestEntry.bytes) {
        throw new BadRequestException(
          `Backup entry ${manifestEntry.path} size does not match the signed manifest`,
        );
      }

      if (this.sha256(payloadEntry.content) !== manifestEntry.sha256) {
        throw new BadRequestException(
          `Backup entry ${manifestEntry.path} checksum verification failed`,
        );
      }
    }

    const certificatesEntry = payload.entries.find(
      (entry) => entry.path === CERTIFICATES_ENTRY_PATH,
    );
    if (!certificatesEntry) {
      throw new BadRequestException(
        'Backup payload is missing certificates.json',
      );
    }

    const certificateCount = this.countBackupCertificates(certificatesEntry.content);
    if (certificateCount !== envelope.manifest.certificateCount) {
      throw new BadRequestException(
        'Backup certificate count does not match the signed manifest',
      );
    }

    return { envelope, payload };
  }

  private countBackupCertificates(serializedCertificates: string): number {
    try {
      const parsed = JSON.parse(serializedCertificates) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('not an array');
      }
      return parsed.length;
    } catch (error) {
      throw new BadRequestException(
        `Backup certificates.json payload is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private validateImportRecord(
    cert: ImportCertificateRecord,
    index: number,
  ): NormalizedImportCertificateRecord {
    if (!cert || typeof cert !== 'object' || Array.isArray(cert)) {
      throw new BadRequestException(
        `Import entry ${index + 1} must be an object`,
      );
    }

    const normalizedDomains = normalizeDomains(
      this.requireDomainArray(cert.domains, index),
      {
        allowWildcard: true,
      },
    );
    const certPem = this.requirePem(cert.certPem, 'certificate', index);
    const keyPem = this.requirePem(cert.keyPem, 'private key', index);
    const issuedAt = this.requireDate(cert.issuedAt, 'issuedAt', index);
    const expiresAt = this.requireDate(cert.expiresAt, 'expiresAt', index);

    if (expiresAt <= issuedAt) {
      throw new BadRequestException(
        `Import entry ${index + 1} has expiresAt earlier than or equal to issuedAt`,
      );
    }

    let certificate: crypto.X509Certificate;
    try {
      certificate = new crypto.X509Certificate(certPem);
    } catch (error) {
      throw new BadRequestException(
        `Import entry ${index + 1} contains an invalid X.509 certificate: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const certificatePublicKey = certificate.publicKey.export({
        type: 'spki',
        format: 'der',
      });
      const privateKeyPublicKey = crypto
        .createPublicKey(crypto.createPrivateKey(keyPem))
        .export({ type: 'spki', format: 'der' });

      if (!Buffer.from(certificatePublicKey).equals(Buffer.from(privateKeyPublicKey))) {
        throw new BadRequestException(
          `Import entry ${index + 1} contains a certificate/private-key mismatch`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Import entry ${index + 1} contains an invalid private key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const certificateDomains = this.extractCertificateDomains(certificate);
    const missingDomains = normalizedDomains.filter(
      (domain) => !certificateDomains.has(domain),
    );
    if (missingDomains.length > 0) {
      throw new BadRequestException(
        `Import entry ${index + 1} is missing certificate SAN/CN coverage for: ${missingDomains.join(', ')}`,
      );
    }

    const certificateNotBefore = new Date(certificate.validFrom);
    const certificateNotAfter = new Date(certificate.validTo);
    if (Number.isNaN(certificateNotBefore.getTime()) || Number.isNaN(certificateNotAfter.getTime())) {
      throw new BadRequestException(
        `Import entry ${index + 1} contains a certificate with invalid validity timestamps`,
      );
    }

    if (issuedAt.getTime() + 60_000 < certificateNotBefore.getTime()) {
      throw new BadRequestException(
        `Import entry ${index + 1} has issuedAt earlier than the certificate validity window`,
      );
    }

    if (expiresAt.getTime() > certificateNotAfter.getTime() + 60_000) {
      throw new BadRequestException(
        `Import entry ${index + 1} has expiresAt later than the certificate validity window`,
      );
    }

    return {
      domains: normalizedDomains,
      certPem,
      keyPem,
      issuedAt,
      expiresAt,
    };
  }

  private requireDomainArray(domains: unknown, index: number): string[] {
    if (!Array.isArray(domains) || domains.length === 0) {
      throw new BadRequestException(
        `Import entry ${index + 1} must include at least one domain`,
      );
    }

    return domains.map((domain) => {
      if (typeof domain !== 'string' || !domain.trim()) {
        throw new BadRequestException(
          `Import entry ${index + 1} contains an invalid domain value`,
        );
      }
      return domain;
    });
  }

  private requirePem(value: unknown, label: string, index: number): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(
        `Import entry ${index + 1} is missing ${label} PEM data`,
      );
    }

    return value;
  }

  private requireDate(value: unknown, label: string, index: number): Date {
    const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Import entry ${index + 1} has an invalid ${label} timestamp`,
      );
    }

    return parsed;
  }

  private extractCertificateDomains(certificate: crypto.X509Certificate): Set<string> {
    const domains = new Set<string>();
    const subjectAltName = certificate.subjectAltName ?? '';

    for (const match of subjectAltName.matchAll(/DNS:([^,\n]+)/g)) {
      const rawDomain = match[1]?.trim();
      if (!rawDomain) {
        continue;
      }

      try {
        const normalized = normalizeDomains([rawDomain], { allowWildcard: true })[0];
        domains.add(normalized);
      } catch {
        // Ignore malformed SAN entries; the import will still fail if the requested
        // domains are not covered by a valid SAN/CN value.
      }
    }

    const commonNameMatch = certificate.subject.match(/(?:^|[\n,\/])\s*CN\s*=\s*([^,\n/]+)/);
    const commonName = commonNameMatch?.[1]?.trim();
    if (commonName) {
      try {
        const normalized = normalizeDomains([commonName], { allowWildcard: true })[0];
        domains.add(normalized);
      } catch {
        // Ignore malformed CN values.
      }
    }

    return domains;
  }

  private resolveBackupFilePath(filename: string): string {
    return path.join(this.backupDir, this.sanitizeBackupFilename(filename));
  }

  private sanitizeBackupFilename(filename: string): string {
    if (path.basename(filename) !== filename || !BACKUP_FILENAME_PATTERN.test(filename)) {
      throw new BadRequestException('Invalid backup filename');
    }

    return filename;
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private signManifest(manifest: BackupManifest, key: Buffer): string {
    return crypto
      .createHmac('sha256', key)
      .update(JSON.stringify(manifest), 'utf8')
      .digest('base64');
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }
}
