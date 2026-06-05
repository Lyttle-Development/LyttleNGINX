require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const acmeStrategyPath = path.join(
  repoRoot,
  'src/certificate/acme-strategy.ts',
);
const certificateServicePath = path.join(
  repoRoot,
  'src/certificate/certificate.service.ts',
);
const acmeControllerPath = path.join(
  repoRoot,
  'src/certificate/acme.controller.ts',
);

const originalAdminEmail = process.env.ADMIN_EMAIL;

function resetModules() {
  delete require.cache[require.resolve(acmeStrategyPath)];
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(acmeControllerPath)];
}

function createCertificateService(prisma, acmeService = undefined) {
  process.env.ADMIN_EMAIL = 'acme-strategy@example.test';
  resetModules();
  const { CertificateService } = require(certificateServicePath);

  return new CertificateService(
    prisma,
    { sendAlert: async () => undefined },
    {
      listOrders: async () => ({ count: 0, orders: [] }),
      getOrder: async () => ({ id: 'order-1' }),
      getArtifact: async () => null,
      getCurrentArtifactForDomainsHash: async () => null,
      getRollbackArtifactForDomainsHash: async () => null,
      transitionOrder: async () => undefined,
      markFailure: async () => undefined,
      completeWithCertificate: async () => undefined,
      getOrCreateOrder: async () => ({ id: 'order-1', attemptCount: 1, metadata: null }),
      recordArtifact: async () => ({ id: 'artifact-1', version: 1 }),
      validateRetryableOrder: async () => ({ id: 'order-1', domains: 'example.com', sourceType: 'acme' }),
      resumeOrder: async () => undefined,
      getLatestArtifactForOrder: async () => null,
    },
    {
      enqueueBroadcastOperation: async () => ({ operationId: 'op-1' }),
      waitForOperationToSettle: async () => ({
        status: 'succeeded',
        completedAt: new Date(),
        acknowledgements: [],
      }),
    },
    {
      getInstanceId: () => 'node-1',
      withLock: async (_name, fn) => fn(),
      acquireLeaderLock: async () => false,
      releaseLeaderLock: async () => undefined,
      releaseAllLocks: async () => undefined,
      isLeader: async () => false,
    },
    {
      recordCertificateSyncFailure() {},
      recordCertificateSyncSuccess() {},
    },
    null,
    acmeService,
  );
}

function createResponseCapture() {
  return {
    statusCode: null,
    contentTypeValue: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    contentType(value) {
      this.contentTypeValue = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'acme-strategy@example.test';
  resetModules();
});

afterEach(() => {
  resetModules();
  if (originalAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL;
  } else {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }
});

describe('ACME strategy hardening', () => {
  it('uses Nest-managed ACME strategy helpers and no longer relies on shell hook arguments', () => {
    const {
      resolveAcmeStrategy,
      getAcmeDirectoryUrl,
      getAcmeAccountKeyPath,
    } = require(acmeStrategyPath);

    const strategy = resolveAcmeStrategy(['example.com', 'www.example.com'], {
      ACME_CHALLENGE_STRATEGY: 'http-01',
      ACME_HTTP01_PROPAGATION_SECONDS: '7',
      LETSENCRYPT_STAGING: 'true',
      ACME_ACCOUNT_PRIVATE_KEY_PATH: '/var/lib/lyttle/acme/account.pem',
    });

    const strategySource = fs.readFileSync(acmeStrategyPath, 'utf8');
    const certificateSource = fs.readFileSync(certificateServicePath, 'utf8');

    assert.deepEqual(strategy, {
      requestedStrategy: 'http-01',
      challengeType: 'http-01',
      provider: 'database-http-01',
      wildcard: false,
      sharedChallengeStore: true,
      propagationSeconds: 7,
      challengeStore: 'database-http',
      visibleInChallengeApi: true,
    });
    assert.equal(
      getAcmeDirectoryUrl({ LETSENCRYPT_STAGING: 'true' }),
      'https://acme-staging-v02.api.letsencrypt.org/directory',
    );
    assert.equal(
      getAcmeAccountKeyPath({
        ACME_ACCOUNT_PRIVATE_KEY_PATH: '/var/lib/lyttle/acme/account.pem',
      }),
      '/var/lib/lyttle/acme/account.pem',
    );
    assert.doesNotMatch(
      strategySource,
      /manual-auth-hook|manual-cleanup-hook|certbot-auth-hook|certbot-cleanup-hook/,
    );
    assert.doesNotMatch(
      certificateSource,
      /runCommand\('certbot'\)|manual-auth-hook|manual-cleanup-hook/,
    );
  });

  it('keeps production ACME issuance on the shared HTTP-01 flow and rejects wildcard or DNS-TXT-dependent strategies', () => {
    const { resolveAcmeStrategy } = require(acmeStrategyPath);

    const strategy = resolveAcmeStrategy(['example.com', 'www.example.com'], {
      ACME_CHALLENGE_STRATEGY: 'auto',
      ACME_HTTP01_PROPAGATION_SECONDS: '5',
    });

    assert.deepEqual(strategy, {
      requestedStrategy: 'auto',
      challengeType: 'http-01',
      provider: 'database-http-01',
      wildcard: false,
      sharedChallengeStore: true,
      propagationSeconds: 5,
      challengeStore: 'database-http',
      visibleInChallengeApi: true,
    });
    assert.throws(
      () =>
        resolveAcmeStrategy(['*.example.com', 'example.com'], {
          ACME_CHALLENGE_STRATEGY: 'auto',
        }),
      /would require DNS TXT record changes/i,
    );
    assert.throws(
      () =>
        resolveAcmeStrategy(['example.com'], {
          ACME_CHALLENGE_STRATEGY: 'dns-01',
        }),
      /not supported.*DNS TXT record changes/i,
    );
  });

  it('lists recent ACME challenges through the certificate service by delegating to the Nest ACME service', async () => {
    let receivedOptions = null;
    const acmeService = {
      listChallenges: async (options) => {
        receivedOptions = options;
        return {
          count: 1,
          challenges: [
            {
              id: 'challenge-1',
              orderId: 'order-1',
              token: 'token-1',
              domain: 'example.com',
              challengeType: 'http-01',
              provider: 'database-http-01',
              status: 'presented',
              presentedAt: new Date('2026-05-24T15:30:00.000Z'),
              cleanedUpAt: null,
              finalizedAt: null,
              lastServedAt: new Date('2026-05-24T15:31:00.000Z'),
              expiresAt: new Date('2026-05-24T16:30:00.000Z'),
              metadata: { providerState: 'published' },
              createdAt: new Date('2026-05-24T15:30:00.000Z'),
            },
          ],
        };
      },
    };

    const service = createCertificateService(
      {
        certificate: {
          findMany: async () => [],
          findUnique: async () => null,
        },
        certificateOrder: {
          findMany: async () => [],
          findUnique: async () => null,
        },
        certificateArtifactVersion: {
          update: async () => undefined,
          updateMany: async () => ({ count: 0 }),
        },
        proxyEntry: {
          findMany: async () => [],
        },
      },
      acmeService,
    );

    const result = await service.listAcmeChallenges({
      status: 'presented',
      limit: 10,
    });

    assert.deepEqual(receivedOptions, {
      status: 'presented',
      limit: 10,
    });
    assert.equal(result.count, 1);
    assert.equal(result.challenges[0].id, 'challenge-1');
    assert.equal(result.challenges[0].token, 'token-1');
    assert.equal(result.challenges[0].status, 'presented');
    assert.deepEqual(result.challenges[0].metadata, {
      providerState: 'published',
    });
  });

  it('serves only active HTTP-01 challenges and marks served challenges through the Nest ACME service', async () => {
    resetModules();
    const { AcmeController } = require(acmeControllerPath);

    const calls = [];
    const controller = new AcmeController({
      getPresentedHttpChallenge: async (token) => {
        if (token === 'token-active') {
          return {
            status: 'found',
            challenge: {
              id: 'challenge-active',
              token,
              keyAuth: 'key-auth-active',
              domain: 'example.com',
              expiresAt: new Date(Date.now() + 60_000),
            },
          };
        }

        if (token === 'token-expired') {
          return { status: 'expired' };
        }

        return { status: 'missing' };
      },
      markChallengeServed: async (challengeId) => {
        calls.push(challengeId);
      },
    });

    const okResponse = createResponseCapture();
    await controller.getChallenge('token-active', okResponse);
    assert.equal(okResponse.statusCode, 200);
    assert.equal(okResponse.contentTypeValue, 'text/plain');
    assert.equal(okResponse.body, 'key-auth-active');

    const expiredResponse = createResponseCapture();
    await controller.getChallenge('token-expired', expiredResponse);
    assert.equal(expiredResponse.statusCode, 404);
    assert.equal(expiredResponse.body, 'Challenge expired');

    const missingResponse = createResponseCapture();
    await controller.getChallenge('token-missing', missingResponse);
    assert.equal(missingResponse.statusCode, 404);
    assert.equal(missingResponse.body, 'Challenge not found');

    assert.deepEqual(calls, ['challenge-active']);
  });
});
