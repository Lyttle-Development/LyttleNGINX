require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const childProcess = require('node:child_process');

const domainUtilsPath = path.join(repoRoot, 'src/utils/domain-utils.ts');
const processUtilsPath = path.join(repoRoot, 'src/utils/process-utils.ts');
const certificateServicePath = path.join(
  repoRoot,
  'src/certificate/certificate.service.ts',
);
const tlsConfigServicePath = path.join(
  repoRoot,
  'src/certificate/tls-config.service.ts',
);
const nginxServicePath = path.join(repoRoot, 'src/nginx/nginx.service.ts');

const originalAdminEmail = process.env.ADMIN_EMAIL;
const originalExecFile = childProcess.execFile;

function resetModules() {
  delete require.cache[require.resolve(domainUtilsPath)];
  delete require.cache[require.resolve(processUtilsPath)];
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(tlsConfigServicePath)];
  delete require.cache[require.resolve(nginxServicePath)];
}

function installExecFileStub(handler) {
  const calls = [];
  childProcess.execFile = (command, args, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    calls.push({ command, args: [...args], options: { ...options } });

    const stdin = {
      end() {},
    };

    Promise.resolve()
      .then(() => handler({ command, args, options }))
      .then((result) => {
        callback?.(null, result?.stdout ?? '', result?.stderr ?? '');
      })
      .catch((error) => {
        callback?.(error, '', error?.stderr ?? '');
      });

    return { stdin };
  };

  return calls;
}

function restoreExecFile() {
  childProcess.execFile = originalExecFile;
}

function loadDomainUtils() {
  resetModules();
  return require(domainUtilsPath);
}

function createCertificateService() {
  process.env.ADMIN_EMAIL = 'session15@example.test';
  resetModules();
  const { CertificateService } = require(certificateServicePath);

  const state = {
    artifact: null,
  };

  const prisma = {
    certificate: {
      create: async ({ data }) => ({ id: 'cert-1', ...data }),
      findFirst: async () => null,
      update: async () => undefined,
      upsert: async ({ create }) => ({ id: 'cert-1', ...create }),
      findUnique: async () => null,
      findMany: async () => [],
      count: async () => 0,
      delete: async () => undefined,
    },
    certificateOrder: {
      findUnique: async () => ({ id: 'order-1', attemptCount: 1 }),
      findMany: async () => [],
    },
    certificateArtifactVersion: {
      update: async ({ data }) => {
        state.artifact = {
          ...(state.artifact ?? {}),
          ...data,
        };
        return state.artifact;
      },
      updateMany: async () => ({ count: state.artifact ? 1 : 0 }),
    },
    proxyEntry: {
      findMany: async () => [],
    },
  };
  const alertService = {
    sendAlert: async () => undefined,
  };
  const certificateOrders = {
    getOrCreateOrder: async () => ({ id: 'order-1', attemptCount: 1 }),
    transitionOrder: async () => undefined,
    markFailure: async () => undefined,
    recordArtifact: async (params) => {
      state.artifact = {
        id: 'artifact-1',
        version: 1,
        domains: params.domains.join(';'),
        domainsHash: 'artifact-hash',
        certPem: params.certPem,
        keyPem: params.keyPem,
        expiresAt: params.expiresAt,
        issuedAt: params.issuedAt,
        activatedAt: params.activatedAt ?? null,
        isCurrent: false,
        distributionStatus: null,
        distributionOperationId: null,
        distributionCompletedAt: null,
        createdByNode: params.createdByNode ?? null,
        certificateId: params.certificateId ?? null,
        metadata: params.metadata ?? null,
        orderId: params.orderId,
      };
      return { id: state.artifact.id, version: state.artifact.version };
    },
    getArtifact: async () => state.artifact,
    getCurrentArtifactForDomainsHash: async () => null,
    getLatestArtifactForOrder: async () => state.artifact,
    getRollbackArtifactForDomainsHash: async () => null,
    validateRetryableOrder: async () => ({ id: 'order-1', sourceType: 'self-signed' }),
    resumeOrder: async () => ({ id: 'order-1' }),
    completeWithCertificate: async () => undefined,
    getOrder: async () => ({ id: 'order-1', status: 'activated' }),
  };
  const clusterOperations = {
    enqueueBroadcastOperation: async (options) => {
      await options.localAction('op-1');
      return { operationId: 'op-1' };
    },
    waitForOperationToSettle: async () => ({
      status: 'succeeded',
      completedAt: new Date(),
      acknowledgements: [
        {
          nodeHostname: 'node-1',
          nodeInstanceId: 'node-1',
          status: 'succeeded',
          errorMessage: null,
        },
      ],
    }),
  };
  const distributedLock = {
    getInstanceId: () => 'node-1',
    withLock: async (_name, fn) => fn(),
    acquireLeaderLock: async () => false,
    releaseLeaderLock: async () => undefined,
    releaseAllLocks: async () => undefined,
    isLeader: async () => false,
  };
  const healthService = {
    recordCertificateSyncFailure() {},
    recordCertificateSyncSuccess() {},
  };

  return new CertificateService(
    prisma,
    alertService,
    certificateOrders,
    clusterOperations,
    distributedLock,
    healthService,
    null,
    undefined,
  );
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'session15@example.test';
  restoreExecFile();
  resetModules();
});

afterEach(() => {
  restoreExecFile();
  resetModules();
  if (originalAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL;
  } else {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }
});

describe('Session 15 strict domain validation and safe process execution', () => {
  it('normalizes Unicode domains to lowercase ASCII and derives safe certificate storage names', () => {
    const { normalizeDomain, normalizeDomains, getCertificateStorageName } =
      loadDomainUtils();

    assert.equal(normalizeDomain(' Exämple.COM. '), 'xn--exmple-cua.com');
    assert.deepEqual(normalizeDomains(['Example.com', ' exämple.com. ']), [
      'example.com',
      'xn--exmple-cua.com',
    ]);

    const storageName = getCertificateStorageName('*.Exämple.com');
    assert.match(storageName, /^cert-wild-[a-z0-9-]+-[a-f0-9]{16}$/);
    assert.doesNotMatch(storageName, /[*/\\\s]/);
  });

  it('rejects malformed, local-only, and path-like domains early', () => {
    const { normalizeDomain } = loadDomainUtils();

    assert.throws(() => normalizeDomain('localhost'), /fully-qualified/i);
    assert.throws(() => normalizeDomain('127.0.0.1'), /IP addresses/i);
    assert.throws(
      () => normalizeDomain('bad/domain.example'),
      /path separators/i,
    );
    assert.throws(
      () => normalizeDomain('bad_domain.example'),
      /unsupported characters detected/i,
    );
    assert.throws(
      () => normalizeDomain('*.example.com', { allowWildcard: false }),
      /wildcard domains are not allowed/i,
    );
  });

  it('uses argument-array OpenSSL execution for TLS connection tests', async () => {
    const calls = installExecFileStub(async ({ command, args }) => {
      assert.equal(command, 'openssl');
      assert.deepEqual(args.slice(0, 2), ['s_client', '-connect']);
      return {
        stdout: 'Protocol  : TLSv1.3\nCipher    : TLS_AES_256_GCM_SHA384\n',
      };
    });

    resetModules();
    const { TlsConfigService } = require(tlsConfigServicePath);
    const service = new TlsConfigService();
    const result = await service.testTlsConnection('Exämple.com');

    assert.equal(result.success, true);
    assert.equal(result.protocol, 'TLSv1.3');
    assert.equal(result.cipher, 'TLS_AES_256_GCM_SHA384');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      's_client',
      '-connect',
      'xn--exmple-cua.com:443',
      '-servername',
      'xn--exmple-cua.com',
    ]);
  });

  it('rejects wildcard ACME issuance because the hardened flow does not require DNS TXT changes', async () => {
    resetModules();
    const { resolveAcmeStrategy } = require(
      path.join(repoRoot, 'src/certificate/acme-strategy.ts'),
    );

    assert.throws(
      () =>
        resolveAcmeStrategy(['*.example.com', 'example.com'], {
          ACME_CHALLENGE_STRATEGY: 'auto',
        }),
      /would require DNS TXT record changes/i,
    );
  });

  it('generates self-signed certificates through safe OpenSSL args and stores normalized domains', async () => {
    const calls = installExecFileStub(async ({ command, args }) => {
      if (command === 'nginx') {
        return { stdout: '' };
      }

      assert.equal(command, 'openssl');

      if (args[0] === 'genrsa') {
        fs.writeFileSync(
          args[2],
          '-----BEGIN PRIVATE KEY-----\nunit-test\n-----END PRIVATE KEY-----\n',
        );
        return { stdout: '' };
      }

      if (args[0] === 'req') {
        const outIndex = args.indexOf('-out');
        fs.writeFileSync(
          args[outIndex + 1],
          '-----BEGIN CERTIFICATE-----\nunit-test\n-----END CERTIFICATE-----\n',
        );
        return { stdout: '' };
      }

      if (args[0] === 'x509' && args.includes('-pubkey')) {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'pkey') {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'x509' && args.includes('-enddate')) {
        return { stdout: 'notAfter=Jan  1 00:00:00 2035 GMT\n' };
      }

      if (args[0] === 'x509' && args.includes('-text')) {
        return {
          stdout:
            'Certificate Data\nX509v3 Subject Alternative Name:\n    DNS:xn--exmple-cua.com\n',
        };
      }

      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    const service = createCertificateService();
    let writtenCertificate = null;
    service.writeCertToFs = (primaryDomain, certPem, keyPem) => {
      writtenCertificate = { primaryDomain, certPem, keyPem };
    };

    const record = await service.generateSelfSignedCertificate([
      ' Exämple.com ',
    ]);
    const generationCalls = calls.filter(
      (call) =>
        call.command === 'openssl' &&
        (call.args[0] === 'genrsa' || call.args[0] === 'req'),
    );

    assert.equal(record.domains, 'xn--exmple-cua.com');
    assert.equal(writtenCertificate.primaryDomain, 'xn--exmple-cua.com');
    assert.equal(generationCalls.length, 2);
    assert.deepEqual(generationCalls[0].args, [
      'genrsa',
      '-out',
      generationCalls[0].args[2],
      '2048',
    ]);
    assert.deepEqual(generationCalls[1].args.slice(0, 8), [
      'req',
      '-new',
      '-x509',
      '-key',
      generationCalls[0].args[2],
      '-out',
      generationCalls[1].args[6],
      '-days',
    ]);
    assert.equal(
      generationCalls[1].args[generationCalls[1].args.indexOf('-subj') + 1],
      '/CN=xn--exmple-cua.com',
    );
    assert.equal(
      generationCalls[1].args[generationCalls[1].args.indexOf('-addext') + 1],
      'subjectAltName=DNS:xn--exmple-cua.com',
    );
  });

  it('renders wildcard server_name values while using safe certificate storage directories', () => {
    const { NginxService } = require(nginxServicePath);
    const { getCertificateStorageName } = require(domainUtilsPath);
    const service = new NginxService();
    const storageName = getCertificateStorageName('*.example.com');

    const existsSync = fs.existsSync;
    fs.existsSync = (filePath) =>
      typeof filePath === 'string' && filePath.includes(storageName);

    try {
      const config = service.generateNginxConfig([
        {
          id: 'proxy-1',
          domains: '*.example.com;example.com',
          proxy_pass_host: 'http://upstream.internal:8080',
          ssl: true,
          type: 'PROXY',
          nginx_custom_code: '',
        },
      ]);

      assert.match(config, /server_name \*\.example\.com example\.com;/);
      assert.match(
        config,
        new RegExp(`/etc/letsencrypt/live/${storageName}/fullchain\\.pem`),
      );
      assert.doesNotMatch(config, /\/etc\/letsencrypt\/live\/\*\.example\.com/);
    } finally {
      fs.existsSync = existsSync;
    }
  });
});
