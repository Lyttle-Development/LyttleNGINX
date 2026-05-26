import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const ENVELOPE_SCHEME = 'lyttle-private-key-envelope/v1';
const DEVELOPMENT_FALLBACK_MASTER_KEY =
  'lyttle-nginx-session19-development-only-master-key';

type EncryptionContext = {
  scope: 'certificate' | 'certificate-artifact';
  domainsHash?: string | null;
  version?: number | null;
};

type WrappedDataKeyMetadata = {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  aad: string;
  ciphertext: string;
};

type EncryptedPayloadMetadata = {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  aad: string;
};

export type PrivateKeyEncryptionMetadata = {
  scheme: typeof ENVELOPE_SCHEME;
  secretType: 'tls-private-key';
  encryptedAt: string;
  provider: {
    type: 'local-master-key';
    keyVersion: string;
    keyId: string;
  };
  context: Required<EncryptionContext>;
  wrappedDataKey: WrappedDataKeyMetadata;
  payload: EncryptedPayloadMetadata;
};

interface PrivateKeyEncryptionProvider {
  readonly type: 'local-master-key';
  readonly keyVersion: string;
  readonly keyId: string;
  wrapDataKey(dataKey: Buffer): WrappedDataKeyMetadata;
  unwrapDataKey(metadata: WrappedDataKeyMetadata): Buffer;
}

class LocalMasterKeyProvider implements PrivateKeyEncryptionProvider {
  readonly type = 'local-master-key' as const;
  readonly keyVersion: string;
  readonly keyId: string;
  private readonly masterKey: Buffer;

  constructor(params: { masterKeyMaterial: string; keyVersion: string }) {
    this.keyVersion = params.keyVersion;
    this.keyId = `local:${this.keyVersion}`;
    this.masterKey = deriveEncryptionKey(params.masterKeyMaterial);
  }

  wrapDataKey(dataKey: Buffer): WrappedDataKeyMetadata {
    const aad = Buffer.from(
      JSON.stringify({
        provider: this.type,
        keyVersion: this.keyVersion,
        keyId: this.keyId,
      }),
      'utf8',
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      aad: aad.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  unwrapDataKey(metadata: WrappedDataKeyMetadata): Buffer {
    const decipher = crypto.createDecipheriv(
      metadata.algorithm,
      this.masterKey,
      Buffer.from(metadata.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(metadata.aad, 'base64'));
    decipher.setAuthTag(Buffer.from(metadata.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(metadata.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }
}

function deriveEncryptionKey(rawSecret: string): Buffer {
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

function toStoredContext(context: EncryptionContext): Required<EncryptionContext> {
  return {
    scope: context.scope,
    domainsHash: context.domainsHash ?? null,
    version: context.version ?? null,
  };
}

@Injectable()
export class PrivateKeyEncryptionService {
  private readonly provider: PrivateKeyEncryptionProvider;

  constructor(private readonly prisma?: PrismaService) {
    this.provider = this.createProvider();
  }

  encryptPrivateKey(
    keyPem: string,
    context: EncryptionContext,
  ): { keyPem: string; keyEncryption: PrivateKeyEncryptionMetadata | null } {
    if (!keyPem.trim()) {
      return {
        keyPem,
        keyEncryption: null,
      };
    }

    const storedContext = toStoredContext(context);
    const dataKey = crypto.randomBytes(32);
    const aad = Buffer.from(
      JSON.stringify({
        secretType: 'tls-private-key',
        context: storedContext,
      }),
      'utf8',
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(keyPem, 'utf8')),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      keyPem: ciphertext.toString('base64'),
      keyEncryption: {
        scheme: ENVELOPE_SCHEME,
        secretType: 'tls-private-key',
        encryptedAt: new Date().toISOString(),
        provider: {
          type: this.provider.type,
          keyVersion: this.provider.keyVersion,
          keyId: this.provider.keyId,
        },
        context: storedContext,
        wrappedDataKey: this.provider.wrapDataKey(dataKey),
        payload: {
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          authTag: authTag.toString('base64'),
          aad: aad.toString('base64'),
        },
      },
    };
  }

  decryptPrivateKey(
    keyPem: string,
    metadata: unknown,
    expectedContext?: EncryptionContext,
  ): string {
    if (!keyPem.trim()) {
      return keyPem;
    }

    if (this.isPlaintextPrivateKey(keyPem)) {
      return keyPem;
    }

    const envelope = this.parseEncryptionMetadata(metadata);
    if (!envelope) {
      throw new Error(
        'Encrypted private key material is missing encryption metadata',
      );
    }

    if (expectedContext) {
      this.assertExpectedContext(envelope.context, expectedContext);
    }

    const dataKey = this.provider.unwrapDataKey(envelope.wrappedDataKey);
    const decipher = crypto.createDecipheriv(
      envelope.payload.algorithm,
      dataKey,
      Buffer.from(envelope.payload.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(envelope.payload.aad, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.payload.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(keyPem, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  ensureEncryptedPrivateKey(params: {
    keyPem: string;
    metadata: unknown;
    context: EncryptionContext;
  }): {
    keyPem: string;
    keyEncryption: PrivateKeyEncryptionMetadata | null;
    changed: boolean;
  } {
    if (!params.keyPem.trim()) {
      return {
        keyPem: params.keyPem,
        keyEncryption: null,
        changed: false,
      };
    }

    const parsedMetadata = this.parseEncryptionMetadata(params.metadata);

    if (this.isPlaintextPrivateKey(params.keyPem)) {
      const encrypted = this.encryptPrivateKey(params.keyPem, params.context);
      return {
        ...encrypted,
        changed: true,
      };
    }

    if (
      parsedMetadata &&
      parsedMetadata.provider.keyVersion === this.provider.keyVersion
    ) {
      return {
        keyPem: params.keyPem,
        keyEncryption: parsedMetadata,
        changed: false,
      };
    }

    const decrypted = this.decryptPrivateKey(
      params.keyPem,
      parsedMetadata,
      params.context,
    );
    const encrypted = this.encryptPrivateKey(decrypted, params.context);

    return {
      ...encrypted,
      changed: true,
    };
  }

  async migrateStoredPrivateKeys(): Promise<{
    certificatesUpdated: number;
    artifactsUpdated: number;
  }> {
    if (!this.prisma) {
      return {
        certificatesUpdated: 0,
        artifactsUpdated: 0,
      };
    }

    let certificatesUpdated = 0;
    let artifactsUpdated = 0;

    const certificates = (await this.prisma.certificate.findMany()) as Array<{
      id: string;
      keyPem: string;
      keyEncryption?: unknown;
      domainsHash: string;
    }>;

    for (const certificate of certificates) {
      const ensured = this.ensureEncryptedPrivateKey({
        keyPem: certificate.keyPem,
        metadata: certificate.keyEncryption ?? null,
        context: {
          scope: 'certificate',
          domainsHash: certificate.domainsHash,
        },
      });

      if (!ensured.changed) {
        continue;
      }

      await this.prisma.certificate.update({
        where: { id: certificate.id },
        data: {
          keyPem: ensured.keyPem,
          keyEncryption: ensured.keyEncryption ?? undefined,
        } as any,
      });
      certificatesUpdated += 1;
    }

    const artifacts = (await this.prisma.certificateArtifactVersion.findMany?.()) as
      | Array<{
          id: string;
          keyPem: string;
          keyEncryption?: unknown;
          domainsHash: string;
          version: number;
        }>
      | undefined;

    for (const artifact of artifacts ?? []) {
      const ensured = this.ensureEncryptedPrivateKey({
        keyPem: artifact.keyPem,
        metadata: artifact.keyEncryption ?? null,
        context: {
          scope: 'certificate-artifact',
          domainsHash: artifact.domainsHash,
          version: artifact.version,
        },
      });

      if (!ensured.changed) {
        continue;
      }

      await this.prisma.certificateArtifactVersion.update({
        where: { id: artifact.id },
        data: {
          keyPem: ensured.keyPem,
          keyEncryption: ensured.keyEncryption ?? undefined,
        } as any,
      });
      artifactsUpdated += 1;
    }

    return {
      certificatesUpdated,
      artifactsUpdated,
    };
  }

  isPlaintextPrivateKey(value: string): boolean {
    return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value);
  }

  private createProvider(): PrivateKeyEncryptionProvider {
    const configuredProvider =
      (process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER ?? 'local').trim().toLowerCase() ||
      'local';

    if (configuredProvider !== 'local') {
      throw new Error(
        `Unsupported PRIVATE_KEY_ENCRYPTION_PROVIDER "${configuredProvider}". Session 19 ships a local envelope-encryption provider plus an abstraction that later sessions can extend for Vault/KMS/HSM integration.`,
      );
    }

    const masterKeyMaterial =
      process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY?.trim() ||
      this.resolveDevelopmentFallbackMasterKey();

    if (
      !process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY?.trim() &&
      process.env.NODE_ENV === 'production'
    ) {
      throw new Error(
        'PRIVATE_KEY_ENCRYPTION_MASTER_KEY must be configured in production to protect stored private keys',
      );
    }

    return new LocalMasterKeyProvider({
      masterKeyMaterial,
      keyVersion: process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION?.trim() || 'v1',
    });
  }

  private resolveDevelopmentFallbackMasterKey(): string {
    return DEVELOPMENT_FALLBACK_MASTER_KEY;
  }

  private parseEncryptionMetadata(
    metadata: unknown,
  ): PrivateKeyEncryptionMetadata | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const candidate = metadata as Record<string, unknown>;
    if (candidate.scheme !== ENVELOPE_SCHEME) {
      return null;
    }

    return candidate as PrivateKeyEncryptionMetadata;
  }

  private assertExpectedContext(
    actual: Required<EncryptionContext>,
    expected: EncryptionContext,
  ) {
    if (actual.scope !== expected.scope) {
      throw new Error(
        `Encrypted private key context mismatch: expected ${expected.scope}, received ${actual.scope}`,
      );
    }

    if (
      expected.domainsHash !== undefined &&
      actual.domainsHash !== (expected.domainsHash ?? null)
    ) {
      throw new Error('Encrypted private key domainsHash context mismatch');
    }

    if (
      expected.version !== undefined &&
      actual.version !== (expected.version ?? null)
    ) {
      throw new Error('Encrypted private key artifact-version context mismatch');
    }
  }
}

