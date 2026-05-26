import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as acme from 'acme-client';
import { PrismaService } from '../prisma/prisma.service';
import {
  getAcmeAccountKeyPath,
  getAcmeDirectoryUrl,
  getAcmeDnsPollIntervalMs,
  getAcmeDnsRecordName,
  getAcmeDnsWaitTimeoutMs,
  getAcmeHttpPollIntervalMs,
  getAcmeHttpVerificationTimeoutMs,
  resolveAcmeStrategy,
  type ResolvedAcmeStrategy,
} from './acme-strategy';
import { normalizeDomains } from '../utils/domain-utils';
import { AcmeChallengeInfoDto } from './dto/acme-challenge.dto';
import type { Authorization, Client } from 'acme-client';
import type { Challenge } from 'acme-client/types/rfc8555';

const DEFAULT_CHALLENGE_TTL_MS = 60 * 60 * 1000;

type AcmeChallengeRecord = {
  id: string;
  orderId: string | null;
  token: string;
  keyAuth: string;
  domain: string;
  challengeType: string;
  provider: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  presentedAt: Date;
  cleanedUpAt: Date | null;
  finalizedAt: Date | null;
  lastServedAt: Date | null;
  expiresAt: Date;
};

export type IssuedAcmeCertificate = {
  certPem: string;
  keyPem: string;
  issuedAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

@Injectable()
export class AcmeService {
  private readonly logger = new Logger(AcmeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async obtainCertificate(params: {
    orderId: string;
    domains: string[];
    instanceId: string;
    adminEmail: string;
  }): Promise<IssuedAcmeCertificate> {
    const domains = normalizeDomains(params.domains, { allowWildcard: true });
    const strategy = resolveAcmeStrategy(domains);
    const accountKey = await this.loadOrCreateAccountKey();
    const client = new acme.Client({
      directoryUrl: getAcmeDirectoryUrl(),
      accountKey,
    });
    const [certificateKey, csr] = await acme.crypto.createCsr({
      commonName: domains[0],
      altNames: domains,
    });

    try {
      const certificate = await client.auto({
        csr,
        email: params.adminEmail,
        termsOfServiceAgreed: true,
        skipChallengeVerification: true,
        challengePriority: [strategy.challengeType],
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
          await this.presentChallenge({
            orderId: params.orderId,
            instanceId: params.instanceId,
            strategy,
            authz,
            challenge,
            keyAuthorization,
          });

          await this.waitForChallengeReadiness({
            client,
            authz,
            challenge,
            strategy,
          });
        },
        challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
          await this.cleanupChallenge({
            orderId: params.orderId,
            strategy,
            authz,
            challenge,
            keyAuthorization,
          });
        },
      });

      await this.finalizeChallengesForOrder(params.orderId, {
        status: 'validated',
      });

      const certPem = certificate.toString();
      const keyPem = Buffer.isBuffer(certificateKey)
        ? certificateKey.toString('utf8')
        : String(certificateKey);
      const certificateInfo = acme.crypto.readCertificateInfo(certPem);
      const accountKeyPath = getAcmeAccountKeyPath();

      return {
        certPem,
        keyPem,
        issuedAt: certificateInfo.notBefore ?? new Date(),
        expiresAt: certificateInfo.notAfter,
        metadata: {
          acme: {
            ...strategy,
            directoryUrl: getAcmeDirectoryUrl(),
            accountKeyPath,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finalizeChallengesForOrder(params.orderId, {
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  async listChallenges(options: {
    status?: string;
    limit?: number;
  } = {}): Promise<{ count: number; challenges: AcmeChallengeInfoDto[] }> {
    const take = Number.isFinite(options.limit)
      ? Math.min(Math.max(options.limit ?? 25, 1), 100)
      : 25;
    const normalizedStatus = options.status?.trim();
    const challenges = (await this.prisma.acmeChallenge.findMany({
      where: normalizedStatus
        ? {
            status: normalizedStatus,
          }
        : undefined,
      take,
      orderBy: [{ presentedAt: 'desc' }, { createdAt: 'desc' }],
    })) as AcmeChallengeRecord[];

    return {
      count: challenges.length,
      challenges: challenges.map((challenge) => this.toChallengeDto(challenge)),
    };
  }

  async getPresentedHttpChallenge(token: string): Promise<
    | { status: 'found'; challenge: AcmeChallengeRecord }
    | { status: 'missing' | 'expired' }
  > {
    const challenge = (await this.prisma.acmeChallenge.findFirst({
      where: {
        token,
        challengeType: 'http-01',
        status: 'presented',
      },
    })) as AcmeChallengeRecord | null;

    if (!challenge) {
      return { status: 'missing' };
    }

    if (new Date() > challenge.expiresAt) {
      await this.prisma.acmeChallenge.update({
        where: { id: challenge.id },
        data: {
          status: 'expired',
          finalizedAt: new Date(),
        },
      });
      return { status: 'expired' };
    }

    return { status: 'found', challenge };
  }

  async markChallengeServed(challengeId: string): Promise<void> {
    await this.prisma.acmeChallenge.update({
      where: { id: challengeId },
      data: {
        lastServedAt: new Date(),
      },
    });
  }

  async finalizeChallengesForOrder(
    orderId: string,
    params: {
      status: 'validated' | 'failed';
      error?: string | null;
    },
  ): Promise<void> {
    const challenges = (await this.prisma.acmeChallenge.findMany({
      where: {
        orderId,
        status: {
          in: ['presented', 'cleaned-up'],
        },
      },
      orderBy: [{ presentedAt: 'desc' }, { createdAt: 'desc' }],
    })) as AcmeChallengeRecord[];

    if (challenges.length === 0) {
      return;
    }

    const finalizedAt = new Date();
    await Promise.all(
      challenges.map((challenge) =>
        this.prisma.acmeChallenge.update({
          where: { id: challenge.id },
          data: {
            status: params.status,
            finalizedAt,
            metadata: this.mergeMetadata(challenge.metadata, {
              finalization: {
                status: params.status,
                error: params.error ?? null,
                finalizedAt: finalizedAt.toISOString(),
              },
            }),
          },
        }),
      ),
    );
  }

  private async presentChallenge(params: {
    orderId: string;
    instanceId: string;
    strategy: ResolvedAcmeStrategy;
    authz: Authorization;
    challenge: Challenge;
    keyAuthorization: string;
  }): Promise<void> {
    const metadata = this.buildChallengeMetadata(params);
    const expiresAt = this.getChallengeExpiry(params.authz);
    const now = new Date();

    await this.prisma.acmeChallenge.upsert({
      where: { token: params.challenge.token },
      create: {
        orderId: params.orderId,
        token: params.challenge.token,
        keyAuth: params.keyAuthorization,
        domain: params.authz.identifier.value,
        challengeType: params.challenge.type,
        provider: params.strategy.provider,
        status: 'presented',
        metadata,
        presentedAt: now,
        expiresAt,
      },
      update: {
        orderId: params.orderId,
        keyAuth: params.keyAuthorization,
        domain: params.authz.identifier.value,
        challengeType: params.challenge.type,
        provider: params.strategy.provider,
        status: 'presented',
        metadata,
        presentedAt: now,
        cleanedUpAt: null,
        finalizedAt: null,
        expiresAt,
      },
    });

    this.logger.log(
      `[ACME] Presented ${params.challenge.type} challenge for ${params.authz.identifier.value} (token: ${params.challenge.token})`,
    );
  }

  private async cleanupChallenge(params: {
    orderId: string;
    strategy: ResolvedAcmeStrategy;
    authz: Authorization;
    challenge: Challenge;
    keyAuthorization: string;
  }): Promise<void> {
    const existing = (await this.prisma.acmeChallenge.findUnique({
      where: { token: params.challenge.token },
    })) as AcmeChallengeRecord | null;

    await this.prisma.acmeChallenge.upsert({
      where: { token: params.challenge.token },
      create: {
        orderId: params.orderId,
        token: params.challenge.token,
        keyAuth: params.keyAuthorization,
        domain: params.authz.identifier.value,
        challengeType: params.challenge.type,
        provider: params.strategy.provider,
        status: 'cleaned-up',
        metadata: this.buildChallengeMetadata(params),
        presentedAt: new Date(),
        cleanedUpAt: new Date(),
        expiresAt: this.getChallengeExpiry(params.authz),
      },
      update: {
        status: 'cleaned-up',
        cleanedUpAt: new Date(),
        metadata: this.mergeMetadata(existing?.metadata, {
          cleanup: {
            cleanedUpAt: new Date().toISOString(),
          },
        }),
      },
    });
  }

  private async waitForChallengeReadiness(params: {
    client: Client;
    authz: Authorization;
    challenge: Challenge;
    strategy: ResolvedAcmeStrategy;
  }): Promise<void> {
    const timeoutMs =
      params.strategy.challengeType === 'dns-01'
        ? getAcmeDnsWaitTimeoutMs()
        : getAcmeHttpVerificationTimeoutMs();
    const pollIntervalMs =
      params.strategy.challengeType === 'dns-01'
        ? getAcmeDnsPollIntervalMs()
        : getAcmeHttpPollIntervalMs();
    const deadline = Date.now() + timeoutMs;
    let lastError: Error | null = null;

    while (Date.now() <= deadline) {
      try {
        await params.client.verifyChallenge(params.authz, params.challenge);
        return;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error ?? 'unknown'));
        await this.sleep(pollIntervalMs);
      }
    }

    throw new Error(
      `Timed out waiting for ${params.challenge.type} challenge readiness for ${params.authz.identifier.value}: ${lastError?.message ?? 'verification never succeeded'}`,
    );
  }

  private async loadOrCreateAccountKey(): Promise<string> {
    const accountKeyPath = getAcmeAccountKeyPath();
    if (fs.existsSync(accountKeyPath)) {
      return fs.readFileSync(accountKeyPath, 'utf8');
    }

    fs.mkdirSync(path.dirname(accountKeyPath), { recursive: true, mode: 0o700 });
    const privateKey = await acme.crypto.createPrivateRsaKey(4096);
    const pem = Buffer.isBuffer(privateKey)
      ? privateKey.toString('utf8')
      : String(privateKey);

    fs.writeFileSync(accountKeyPath, pem, {
      encoding: 'utf8',
      mode: 0o600,
    });

    this.logger.log(`[ACME] Created persistent ACME account key at ${accountKeyPath}`);
    return pem;
  }

  private buildChallengeMetadata(params: {
    strategy: ResolvedAcmeStrategy;
    instanceId?: string;
    authz: Authorization;
    challenge: Challenge;
    keyAuthorization: string;
  }): Record<string, unknown> {
    const base: Record<string, unknown> = {
      authorizationUrl: params.authz.url,
      challengeUrl: params.challenge.url,
      provider: params.strategy.provider,
      requestedStrategy: params.strategy.requestedStrategy,
      challengeStore: params.strategy.challengeStore,
      visibleInChallengeApi: params.strategy.visibleInChallengeApi,
      sharedChallengeStore: params.strategy.sharedChallengeStore,
      propagationSeconds: params.strategy.propagationSeconds,
      wildcard: Boolean(params.authz.wildcard),
      presentedByNode: params.instanceId ?? null,
    };

    if (params.challenge.type === 'http-01') {
      return {
        ...base,
        httpPath: `/.well-known/acme-challenge/${params.challenge.token}`,
      };
    }

    const recordName = getAcmeDnsRecordName(params.authz.identifier.value);
    return {
      ...base,
      recordName,
      recordType: 'TXT',
      recordValue: params.keyAuthorization,
      verificationMode: 'external-dns',
    };
  }

  private getChallengeExpiry(authz: Authorization): Date {
    if (typeof authz.expires === 'string') {
      const parsed = new Date(authz.expires);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return new Date(Date.now() + DEFAULT_CHALLENGE_TTL_MS);
  }

  private toChallengeDto(challenge: AcmeChallengeRecord): AcmeChallengeInfoDto {
    return {
      id: challenge.id,
      orderId: challenge.orderId,
      token: challenge.token,
      domain: challenge.domain,
      challengeType: challenge.challengeType,
      provider: challenge.provider,
      status: challenge.status,
      presentedAt: challenge.presentedAt,
      cleanedUpAt: challenge.cleanedUpAt,
      finalizedAt: challenge.finalizedAt,
      lastServedAt: challenge.lastServedAt,
      expiresAt: challenge.expiresAt,
      metadata: challenge.metadata,
      createdAt: challenge.createdAt,
    };
  }

  private mergeMetadata(
    current: unknown,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    return {
      ...base,
      ...patch,
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

