require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const request = require('supertest');
const { APP_GUARD } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthController } = require('../../src/auth/auth.controller');
const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');

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

describe('Session 7 auth foundation', () => {
  const originalEnv = {
    API_KEY: process.env.API_KEY,
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
    AUTH_DEFAULT_ADMIN_ROLES: process.env.AUTH_DEFAULT_ADMIN_ROLES,
    AUTH_DEFAULT_ADMIN_SCOPES: process.env.AUTH_DEFAULT_ADMIN_SCOPES,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
  };

  let app;
  let httpServer;

  before(async () => {
    process.env.API_KEY = 'session7-legacy-key';
    process.env.AUTH_JWT_SECRET = 'session7-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';
    process.env.AUTH_DEFAULT_ADMIN_ROLES = 'platform-admin,operator';
    process.env.AUTH_DEFAULT_ADMIN_SCOPES = 'admin:full,cluster:read';
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '600';

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: APP_GUARD,
          useClass: ApiKeyGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  after(async () => {
    await app?.close();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('attaches a structured admin identity for legacy API-key requests', async () => {
    await request(httpServer)
      .get('/auth/me')
      .set('X-API-Key', 'session7-legacy-key')
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.authenticated, true);
        assert.equal(body.identity.authMethod, 'api-key');
        assert.equal(body.identity.actorType, 'admin');
        assert.equal(body.identity.displayName, 'legacy-api-key-1');
        assert.deepEqual(body.identity.roles, ['platform-admin', 'operator']);
        assert.deepEqual(body.identity.scopes, ['admin:full', 'cluster:read']);
        assert.match(body.identity.apiKeyId, /^1-[a-f0-9]{12}$/);
      });
  });

  it('exposes auth capabilities and supports API-key to bearer token exchange', async () => {
    const tokenResponse = await request(httpServer)
      .get('/auth/info')
      .set('X-API-Key', 'session7-legacy-key')
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.authEnabled, true);
        assert.deepEqual(body.methods, ['api-key', 'bearer-token']);
        assert.equal(body.tokenExchangeEnabled, true);
        assert.deepEqual(body.supportedBearerAlgorithms, ['HS256']);
      });

    assert.ok(tokenResponse.body);

    const exchange = await request(httpServer)
      .post('/auth/token')
      .set('X-API-Key', 'session7-legacy-key')
      .expect(200);

    assert.equal(exchange.body.tokenType, 'Bearer');
    assert.equal(exchange.body.actor.actorType, 'admin');
    assert.deepEqual(exchange.body.actor.roles, ['platform-admin', 'operator']);

    await request(httpServer)
      .get('/auth/status')
      .set('Authorization', `Bearer ${exchange.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.authenticated, true);
        assert.equal(body.identity.authMethod, 'bearer-token');
        assert.equal(body.identity.actorType, 'admin');
        assert.equal(body.identity.issuer, 'lyttle-nginx.test');
        assert.deepEqual(body.identity.audience, ['lyttle-nginx-admin']);
      });
  });

  it('accepts internal-node bearer identities and rejects expired bearer tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const internalNodeToken = signHs256Token(
      {
        sub: 'node-a',
        iss: 'lyttle-nginx.test',
        aud: 'lyttle-nginx-admin',
        iat: now,
        nbf: now,
        exp: now + 300,
        actor_type: 'internal-node',
        node_id: 'node-a',
        scope: 'cluster:internal node:sync',
        roles: ['internal-node'],
        name: 'swarm-node-a',
      },
      'session7-super-secret',
    );

    await request(httpServer)
      .get('/auth/me')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.identity.authMethod, 'bearer-token');
        assert.equal(body.identity.actorType, 'internal-node');
        assert.equal(body.identity.nodeId, 'node-a');
        assert.deepEqual(body.identity.roles, ['internal-node']);
        assert.deepEqual(body.identity.scopes, ['cluster:internal', 'node:sync']);
      });

    const expiredToken = signHs256Token(
      {
        sub: 'operator-1',
        iss: 'lyttle-nginx.test',
        aud: 'lyttle-nginx-admin',
        iat: now - 120,
        nbf: now - 120,
        exp: now - 60,
        actor_type: 'admin',
      },
      'session7-super-secret',
    );

    await request(httpServer)
      .get('/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401)
      .expect(({ body }) => {
        assert.match(body.message, /expired/i);
      });
  });
});
