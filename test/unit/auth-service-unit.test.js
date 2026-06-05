const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const authServiceModulePath = path.join(repoRoot, 'src/auth/auth.service.ts');

const managedEnvKeys = [
  'API_KEY',
  'AUTH_JWT_SECRET',
  'AUTH_JWT_ISSUER',
  'AUTH_JWT_AUDIENCE',
  'AUTH_DEFAULT_ADMIN_ROLES',
  'AUTH_DEFAULT_ADMIN_SCOPES',
  'AUTH_ACCESS_TOKEN_TTL_SECONDS',
  'AUTH_JWT_ALLOWED_ALGS',
];
const originalEnv = Object.fromEntries(
  managedEnvKeys.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetAuthServiceModule() {
  delete require.cache[require.resolve(authServiceModulePath)];
}

function createAuthService() {
  resetAuthServiceModule();
  const { AuthService } = require(authServiceModulePath);
  return new AuthService();
}

function signHs256Token(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

afterEach(() => {
  restoreEnv();
  resetAuthServiceModule();
});

describe('auth service unit harness baseline', () => {
  it('round-trips configured API-key identities through local bearer-token issuance', () => {
    process.env.API_KEY = 'alpha-key,beta-key';
    process.env.AUTH_JWT_SECRET = 'auth-service-unit-secret';
    process.env.AUTH_JWT_ISSUER = 'auth-service-unit.test';
    process.env.AUTH_JWT_AUDIENCE = 'auth-service-unit-admin';
    process.env.AUTH_DEFAULT_ADMIN_ROLES = 'platform-admin,operator';
    process.env.AUTH_DEFAULT_ADMIN_SCOPES = 'admin:full,cluster:read';
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '300';

    const service = createAuthService();
    const configuredKeys = service.listConfiguredApiKeys();
    const identity = service.authenticateApiKey(' beta-key ');

    assert.equal(service.isAuthEnabled(), true);
    assert.equal(configuredKeys.length, 2);
    assert.match(configuredKeys[0].fingerprint, /^[a-f0-9]{16}$/);
    assert.ok(identity);
    assert.equal(identity.authMethod, 'api-key');
    assert.equal(identity.actorType, 'admin');
    assert.deepEqual(identity.roles, ['platform-admin', 'operator']);
    assert.deepEqual(identity.scopes, ['admin:full', 'cluster:read']);

    identity.roles.push('mutated-locally');
    const freshIdentity = service.authenticateApiKey('beta-key');
    assert.deepEqual(freshIdentity.roles, ['platform-admin', 'operator']);

    const issued = service.issueAccessToken(freshIdentity);
    const resolved = service.authenticateBearerToken(issued.accessToken);

    assert.equal(resolved.authMethod, 'bearer-token');
    assert.equal(resolved.actorType, 'admin');
    assert.equal(resolved.issuer, 'auth-service-unit.test');
    assert.deepEqual(resolved.audience, ['auth-service-unit-admin']);
    assert.deepEqual(resolved.roles, ['platform-admin', 'operator']);
    assert.deepEqual(resolved.scopes, ['admin:full', 'cluster:read']);
    assert.equal(service.authenticateApiKey('missing-key'), null);
  });

  it('rejects bearer tokens with the wrong audience or an unsupported algorithm', () => {
    process.env.AUTH_JWT_SECRET = 'auth-service-unit-secret';
    process.env.AUTH_JWT_ISSUER = 'auth-service-unit.test';
    process.env.AUTH_JWT_AUDIENCE = 'auth-service-unit-admin';
    process.env.AUTH_JWT_ALLOWED_ALGS = 'HS256';

    const service = createAuthService();
    const now = Math.floor(Date.now() / 1000);

    const wrongAudienceToken = signHs256Token(
      {
        sub: 'operator-1',
        iss: 'auth-service-unit.test',
        aud: 'different-audience',
        iat: now,
        nbf: now,
        exp: now + 120,
        roles: ['operator'],
        scope: 'cluster:read',
      },
      'auth-service-unit-secret',
    );

    assert.throws(
      () => service.authenticateBearerToken(wrongAudienceToken),
      /audience is invalid/i,
    );

    const unsupportedHeader = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const unsupportedPayload = Buffer.from(
      JSON.stringify({
        sub: 'operator-2',
        iss: 'auth-service-unit.test',
        aud: 'auth-service-unit-admin',
        iat: now,
        nbf: now,
        exp: now + 120,
      }),
    ).toString('base64url');
    const unsupportedToken = `${unsupportedHeader}.${unsupportedPayload}.unsigned`;

    assert.throws(
      () => service.authenticateBearerToken(unsupportedToken),
      /unsupported bearer token algorithm/i,
    );
  });
});

