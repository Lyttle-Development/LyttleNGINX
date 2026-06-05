require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const encryptionServicePath = path.join(
  repoRoot,
  'src/certificate/private-key-encryption.service.ts',
);
const backupServicePath = path.join(
  repoRoot,
  'src/certificate/certificate-backup.service.ts',
);
const domainUtilsPath = path.join(repoRoot, 'src/utils/domain-utils.ts');

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBqzCCAVCgAwIBAgIUXj2axSEIzp9WQkQnsHhPNeuGmm4wCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLZXhhbXBsZS5jb20wHhcNMjYwNTI2MTgzNjUzWhcNMzYwNTIz
MTgzNjUzWjAWMRQwEgYDVQQDDAtleGFtcGxlLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABN1hBq/wyvIjIh+Hg1XT/WAL7vwq3olyr1GCKDMbl+yYpTHbOFF/
2mMdQfkcOXFvAlNa4tJxlpPQ9AqIpbUjfUCjfDB6MB0GA1UdDgQWBBQTeY9QpI1O
tUGKc6LZpmhJ98f7CDAfBgNVHSMEGDAWgBQTeY9QpI1OtUGKc6LZpmhJ98f7CDAP
BgNVHRMBAf8EBTADAQH/MCcGA1UdEQQgMB6CC2V4YW1wbGUuY29tgg93d3cuZXhh
bXBsZS5jb20wCgYIKoZIzj0EAwIDSQAwRgIhAIk6kq5Fdvyw2EDkfqUtYrM1IHAG
aKUyOFucZhk0VqmIAiEAzaGSXKVBsKMoA+4EHXTZ+gJV2IhFVDfTTCivqzBMiB0=
-----END CERTIFICATE-----
`;

const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgKxTl2EOJ4qdIDZSD
gHgdj3PXIYhR1gU9hxnOndxEC6ahRANCAATdYQav8MryIyIfh4NV0/1gC+78Kt6J
cq9RgigzG5fsmKUx2zhRf9pjHUH5HDlxbwJTWuLScZaT0PQKiKW1I31A
-----END PRIVATE KEY-----
`;

const OTHER_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgo+4VXi5sivNgJ9W7
gmzg8DhmGUzIpzlynUQR/CeNfJ+hRANCAAT7sur+do08NANrfUs5oOiwD4UrbCoa
gpZeLbN4K8ukBD8okY9+xJZ9zxJZCmlZ5wWTkRHijKt04SW/4JMEHdzm
-----END PRIVATE KEY-----
`;

const CERT_ISSUED_AT = '2026-05-26T18:36:53.000Z';
const CERT_EXPIRES_AT = '2036-05-23T18:36:53.000Z';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  BACKUP_DIR: process.env.BACKUP_DIR,
  BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY,
  BACKUP_ENCRYPTION_KEY_VERSION: process.env.BACKUP_ENCRYPTION_KEY_VERSION,
  PRIVATE_KEY_ENCRYPTION_PROVIDER: process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER,
  PRIVATE_KEY_ENCRYPTION_MASTER_KEY:
    process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY,
  PRIVATE_KEY_ENCRYPTION_KEY_VERSION:
    process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION,
};

let tempDir;

function resetModules() {
  delete require.cache[require.resolve(encryptionServicePath)];
  delete require.cache[require.resolve(backupServicePath)];
  delete require.cache[require.resolve(domainUtilsPath)];
}

function clone(value) {
  return structuredClone(value);
}

function createPrismaMock() {
  const state = {
    certificates: [],
    certificateSequence: 0,
  };

  return {
    state,
    certificate: {
      async findMany() {
        return state.certificates.map(clone);
      },
      async findFirst({ where } = {}) {
        const certificate =
          state.certificates.find((entry) => {
            if (where?.domains && entry.domains !== where.domains) {
              return false;
            }
            if (where?.domainsHash && entry.domainsHash !== where.domainsHash) {
              return false;
            }
            return true;
          }) ?? null;
        return certificate ? clone(certificate) : null;
      },
      async findUnique({ where }) {
        const certificate =
          state.certificates.find((entry) => {
            if (where?.id) {
              return entry.id === where.id;
            }
            if (where?.domainsHash) {
              return entry.domainsHash === where.domainsHash;
            }
            return false;
          }) ?? null;
        return certificate ? clone(certificate) : null;
      },
      async create({ data }) {
        state.certificateSequence += 1;
        const now = new Date();
        const certificate = {
          id: `cert-${state.certificateSequence}`,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.certificates.push(certificate);
        return clone(certificate);
      },
    },
  };
}

async function seedEncryptedCertificate(prisma) {
  const { PrivateKeyEncryptionService } = require(encryptionServicePath);
  const { hashDomains, joinDomains, normalizeDomains } = require(domainUtilsPath);
  const encryptionService = new PrivateKeyEncryptionService(prisma);
  const domains = normalizeDomains(['example.com', 'www.example.com'], {
    allowWildcard: true,
  });
  const domainsHash = hashDomains(domains, { allowWildcard: true });
  const encryptedKey = encryptionService.encryptPrivateKey(KEY_PEM, {
    scope: 'certificate',
    domainsHash,
  });

  prisma.state.certificates.push({
    id: 'cert-seeded',
    domains: joinDomains(domains, { allowWildcard: true }),
    domainsHash,
    certPem: CERT_PEM,
    keyPem: encryptedKey.keyPem,
    keyEncryption: encryptedKey.keyEncryption,
    issuedAt: new Date(CERT_ISSUED_AT),
    expiresAt: new Date(CERT_EXPIRES_AT),
    lastUsedAt: new Date(CERT_ISSUED_AT),
    isOrphaned: false,
    status: 'active',
    createdAt: new Date(CERT_ISSUED_AT),
    updatedAt: new Date(CERT_ISSUED_AT),
  });

  return encryptionService;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyttlenginx-backup-hardening-'));
  process.env.NODE_ENV = 'test';
  process.env.BACKUP_DIR = tempDir;
  process.env.BACKUP_ENCRYPTION_KEY = 'backup-hardening-test-backup-encryption-key';
  process.env.BACKUP_ENCRYPTION_KEY_VERSION = 'backup-v1';
  process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER = 'local';
  process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY =
    'backup-hardening-test-private-key-master-key';
  process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION = 'backup-private-key-v1';
  resetModules();
});

afterEach(() => {
  resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('backup, export, import, and restore hardening', () => {
  it('creates encrypted backups that can be verified and restored without re-exposing plaintext at rest', async () => {
    const prisma = createPrismaMock();
    const encryptionService = await seedEncryptedCertificate(prisma);
    const { CertificateBackupService } = require(backupServicePath);
    const backupService = new CertificateBackupService(prisma, encryptionService);

    const backup = await backupService.createBackup();
    assert.match(backup.filename, /\.lyttlebackup$/);

    const rawBackupFile = fs.readFileSync(backup.path, 'utf8');
    assert.doesNotMatch(rawBackupFile, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(rawBackupFile, /BEGIN CERTIFICATE/);

    const verification = await backupService.verifyBackup(backup.filename);
    assert.deepEqual(
      {
        verified: verification.verified,
        certificateCount: verification.certificateCount,
        entryCount: verification.entryCount,
        keyVersion: verification.keyVersion,
      },
      {
        verified: true,
        certificateCount: 1,
        entryCount: 4,
        keyVersion: 'backup-v1',
      },
    );

    const restorePrisma = createPrismaMock();
    const { PrivateKeyEncryptionService } = require(encryptionServicePath);
    const restoreEncryptionService = new PrivateKeyEncryptionService(restorePrisma);
    const restoreService = new CertificateBackupService(
      restorePrisma,
      restoreEncryptionService,
    );

    const restored = await restoreService.restoreBackup(backup.filename);
    assert.deepEqual(
      {
        imported: restored.imported,
        skipped: restored.skipped,
        errors: restored.errors,
        verifiedBackup: restored.verifiedBackup.verified,
      },
      {
        imported: 1,
        skipped: 0,
        errors: 0,
        verifiedBackup: true,
      },
    );
    assert.equal(restorePrisma.state.certificates.length, 1);
    assert.doesNotMatch(
      restorePrisma.state.certificates[0].keyPem,
      /BEGIN PRIVATE KEY/,
    );

    const exported = await restoreService.exportCertificate(
      restorePrisma.state.certificates[0].id,
    );
    assert.equal(exported.keyPem, KEY_PEM);
    assert.deepEqual(exported.domains, ['example.com', 'www.example.com']);
  });

  it('rejects tampered encrypted backups before restore can accept any data', async () => {
    const prisma = createPrismaMock();
    const encryptionService = await seedEncryptedCertificate(prisma);
    const { CertificateBackupService } = require(backupServicePath);
    const backupService = new CertificateBackupService(prisma, encryptionService);

    const backup = await backupService.createBackup();
    const envelope = JSON.parse(fs.readFileSync(backup.path, 'utf8'));
    envelope.manifest.entries[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(backup.path, JSON.stringify(envelope, null, 2), 'utf8');

    await assert.rejects(
      () => backupService.verifyBackup(backup.filename),
      /signature verification failed/i,
    );
    await assert.rejects(
      () => backupService.restoreBackup(backup.filename),
      /signature verification failed/i,
    );
  });

  it('rejects invalid direct imports and does not persist mismatched certificate material', async () => {
    const prisma = createPrismaMock();
    const { PrivateKeyEncryptionService } = require(encryptionServicePath);
    const { CertificateBackupService } = require(backupServicePath);
    const backupService = new CertificateBackupService(
      prisma,
      new PrivateKeyEncryptionService(prisma),
    );

    const result = await backupService.importCertificates([
      {
        domains: ['example.com', 'www.example.com'],
        certPem: CERT_PEM,
        keyPem: OTHER_KEY_PEM,
        issuedAt: CERT_ISSUED_AT,
        expiresAt: CERT_EXPIRES_AT,
      },
    ]);

    assert.deepEqual(result, {
      imported: 0,
      skipped: 0,
      errors: 1,
    });
    assert.equal(prisma.state.certificates.length, 0);
  });
});

