require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const encryptionServicePath = path.join(
  repoRoot,
  'src/certificate/private-key-encryption.service.ts',
);
const certificateOrderServicePath = path.join(
  repoRoot,
  'src/certificate/certificate-order.service.ts',
);
const certificateBackupServicePath = path.join(
  repoRoot,
  'src/certificate/certificate-backup.service.ts',
);

const originalMasterKey = process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY;
const originalKeyVersion = process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION;
const originalProvider = process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER;
const originalNodeEnv = process.env.NODE_ENV;

const VALID_CERT_PEM = `-----BEGIN CERTIFICATE-----
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

const VALID_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgKxTl2EOJ4qdIDZSD
gHgdj3PXIYhR1gU9hxnOndxEC6ahRANCAATdYQav8MryIyIfh4NV0/1gC+78Kt6J
cq9RgigzG5fsmKUx2zhRf9pjHUH5HDlxbwJTWuLScZaT0PQKiKW1I31A
-----END PRIVATE KEY-----
`;

function resetModules() {
  delete require.cache[require.resolve(encryptionServicePath)];
  delete require.cache[require.resolve(certificateOrderServicePath)];
  delete require.cache[require.resolve(certificateBackupServicePath)];
}

function clone(value) {
  return structuredClone(value);
}

function applyDataPatch(record, data) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, 'increment')
    ) {
      record[key] = (record[key] ?? 0) + value.increment;
      continue;
    }

    record[key] = value;
  }
}

function createPrismaMock() {
  const state = {
    certificates: [],
    artifacts: [],
    events: [],
    certificateSequence: 0,
    artifactSequence: 0,
    eventSequence: 0,
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
      async update({ where, data }) {
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

        if (!certificate) {
          throw new Error(`Certificate not found for update: ${JSON.stringify(where)}`);
        }

        applyDataPatch(certificate, data);
        certificate.updatedAt = new Date();
        return clone(certificate);
      },
    },
    certificateArtifactVersion: {
      async findMany() {
        return state.artifacts.map(clone);
      },
      async findFirst({ where, orderBy } = {}) {
        const results = state.artifacts.filter((entry) => {
          if (where?.domainsHash && entry.domainsHash !== where.domainsHash) {
            return false;
          }
          return true;
        });
        if (orderBy?.version === 'desc') {
          results.sort((left, right) => right.version - left.version);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async create({ data }) {
        state.artifactSequence += 1;
        const artifact = {
          id: `artifact-${state.artifactSequence}`,
          createdAt: new Date(),
          ...data,
        };
        state.artifacts.push(artifact);
        return clone(artifact);
      },
      async update({ where, data }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        if (!artifact) {
          throw new Error(`Artifact not found for update: ${where.id}`);
        }
        applyDataPatch(artifact, data);
        return clone(artifact);
      },
      async findUnique({ where }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        return artifact ? clone(artifact) : null;
      },
    },
    certificateOrderEvent: {
      async create({ data }) {
        state.eventSequence += 1;
        const event = {
          id: `event-${state.eventSequence}`,
          occurredAt: new Date(),
          ...data,
        };
        state.events.push(event);
        return clone(event);
      },
    },
  };
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER = 'local';
  process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY =
    'session19-unit-test-master-key-material';
  process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION = 'session19-v1';
  resetModules();
});

afterEach(() => {
  resetModules();

  if (originalMasterKey === undefined) {
    delete process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY;
  } else {
    process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY = originalMasterKey;
  }

  if (originalKeyVersion === undefined) {
    delete process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION;
  } else {
    process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION = originalKeyVersion;
  }

  if (originalProvider === undefined) {
    delete process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER;
  } else {
    process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER = originalProvider;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe('Session 19 private-key encryption at rest', () => {
  it('backfills legacy plaintext keys and supports re-encryption when the key version changes', async () => {
    const prisma = createPrismaMock();
    prisma.state.certificates.push({
      id: 'cert-legacy',
      domains: 'example.com',
      domainsHash: 'hash-example',
      certPem: '-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----\n',
      keyPem: '-----BEGIN PRIVATE KEY-----\nlegacy-cert\n-----END PRIVATE KEY-----\n',
      keyEncryption: null,
      expiresAt: new Date('2035-01-01T00:00:00.000Z'),
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      isOrphaned: false,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prisma.state.artifacts.push({
      id: 'artifact-legacy',
      orderId: 'order-1',
      certificateId: null,
      domains: 'example.com',
      domainsHash: 'hash-example',
      version: 1,
      sourceType: 'self-signed',
      certPem: '-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----\n',
      keyPem: '-----BEGIN PRIVATE KEY-----\nlegacy-artifact\n-----END PRIVATE KEY-----\n',
      keyEncryption: null,
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2035-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const { PrivateKeyEncryptionService } = require(encryptionServicePath);
    const encryptionService = new PrivateKeyEncryptionService(prisma);

    const migrated = await encryptionService.migrateStoredPrivateKeys();

    assert.deepEqual(migrated, {
      certificatesUpdated: 1,
      artifactsUpdated: 1,
    });
    assert.doesNotMatch(prisma.state.certificates[0].keyPem, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(prisma.state.artifacts[0].keyPem, /BEGIN PRIVATE KEY/);
    assert.equal(
      prisma.state.certificates[0].keyEncryption.provider.keyVersion,
      'session19-v1',
    );
    assert.equal(
      prisma.state.artifacts[0].keyEncryption.provider.keyVersion,
      'session19-v1',
    );
    assert.match(
      encryptionService.decryptPrivateKey(
        prisma.state.certificates[0].keyPem,
        prisma.state.certificates[0].keyEncryption,
        {
          scope: 'certificate',
          domainsHash: 'hash-example',
        },
      ),
      /legacy-cert/,
    );

    process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION = 'session19-v2';
    resetModules();
    const { PrivateKeyEncryptionService: RotatingEncryptionService } = require(
      encryptionServicePath,
    );
    const rotatingService = new RotatingEncryptionService(prisma);
    const rotated = await rotatingService.migrateStoredPrivateKeys();

    assert.deepEqual(rotated, {
      certificatesUpdated: 1,
      artifactsUpdated: 1,
    });
    assert.equal(
      prisma.state.certificates[0].keyEncryption.provider.keyVersion,
      'session19-v2',
    );
    assert.equal(
      prisma.state.artifacts[0].keyEncryption.provider.keyVersion,
      'session19-v2',
    );
    assert.match(
      rotatingService.decryptPrivateKey(
        prisma.state.artifacts[0].keyPem,
        prisma.state.artifacts[0].keyEncryption,
        {
          scope: 'certificate-artifact',
          domainsHash: 'hash-example',
          version: 1,
        },
      ),
      /legacy-artifact/,
    );
  });

  it('stores new artifact and imported certificate keys encrypted while still exporting decrypted PEMs', async () => {
    const prisma = createPrismaMock();
    const { PrivateKeyEncryptionService } = require(encryptionServicePath);
    const { CertificateOrderService } = require(certificateOrderServicePath);
    const { CertificateBackupService } = require(certificateBackupServicePath);
    const encryptionService = new PrivateKeyEncryptionService(prisma);
    const orderService = new CertificateOrderService(prisma, encryptionService);
    const backupService = new CertificateBackupService(prisma, encryptionService);
    const plaintextKey = VALID_KEY_PEM;

    const artifact = await orderService.recordArtifact({
      orderId: 'order-1',
      certificateId: null,
      domains: ['Example.com'],
      sourceType: 'uploaded',
      certPem: VALID_CERT_PEM,
      keyPem: plaintextKey,
      issuedAt: new Date('2026-05-26T18:36:53.000Z'),
      expiresAt: new Date('2036-05-23T18:36:53.000Z'),
      activatedAt: null,
      createdByNode: 'node-1',
      metadata: { activation: 'pending' },
    });

    assert.equal(artifact.version, 1);
    assert.equal(prisma.state.artifacts.length, 1);
    assert.doesNotMatch(prisma.state.artifacts[0].keyPem, /BEGIN PRIVATE KEY/);
    assert.equal(
      prisma.state.artifacts[0].keyEncryption.provider.keyVersion,
      'session19-v1',
    );
    assert.equal(
      encryptionService.decryptPrivateKey(
        prisma.state.artifacts[0].keyPem,
        prisma.state.artifacts[0].keyEncryption,
        {
          scope: 'certificate-artifact',
          domainsHash: prisma.state.artifacts[0].domainsHash,
          version: 1,
        },
      ),
      plaintextKey,
    );

    const imported = await backupService.importCertificates([
      {
        domains: ['example.com', 'www.example.com'],
        certPem: VALID_CERT_PEM,
        keyPem: plaintextKey,
        expiresAt: new Date('2036-05-23T18:36:53.000Z'),
        issuedAt: new Date('2026-05-26T18:36:53.000Z'),
      },
    ]);

    assert.deepEqual(imported, {
      imported: 1,
      skipped: 0,
      errors: 0,
    });
    assert.equal(prisma.state.certificates.length, 1);
    assert.doesNotMatch(prisma.state.certificates[0].keyPem, /BEGIN PRIVATE KEY/);
    assert.equal(
      prisma.state.certificates[0].keyEncryption.provider.keyVersion,
      'session19-v1',
    );

    const exported = await backupService.exportCertificate(prisma.state.certificates[0].id);
    assert.equal(exported.keyPem, plaintextKey);
    assert.deepEqual(exported.domains, ['example.com', 'www.example.com']);
  });
});

