require('reflect-metadata');

const { after, before, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const request = require('supertest');
const { ValidationPipe } = require('@nestjs/common');
const { APP_GUARD } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');
const {
  AuthorizationGuard,
} = require('../../src/auth/guards/authorization.guard');
const { NginxService } = require('../../src/nginx/nginx.service');
const { PrismaService } = require('../../src/prisma/prisma.service');
const { ProxyController } = require('../../src/proxy/proxy.controller');
const { ProxyService } = require('../../src/proxy/proxy.service');

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

function buildAdminToken(role) {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Token(
    {
      sub: `${role}-user`,
      iss: 'lyttle-nginx.test',
      aud: 'lyttle-nginx-admin',
      iat: now,
      nbf: now,
      exp: now + 300,
      actor_type: 'admin',
      roles: [role],
      scope: 'admin:full',
      name: `${role}-user`,
    },
    'proxy-management-super-secret',
  );
}

function createEntry(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    domains: overrides.domains ?? 'app.example.com',
    proxy_pass_host:
      overrides.proxy_pass_host ?? 'http://upstream.internal:8080/',
    nginx_custom_code: overrides.nginx_custom_code ?? null,
    type: overrides.type ?? 'PROXY',
    ssl: overrides.ssl ?? false,
  };
}

describe('proxy management API', () => {
  const originalEnv = {
    API_KEY: process.env.API_KEY,
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
  };

  let app;
  let httpServer;
  let proxyEntries;
  let nextId;

  const prismaMock = {
    proxyEntry: {
      async findMany(args = {}) {
        let entries = [...proxyEntries];
        const excludedId = args.where?.id?.not;
        if (excludedId !== undefined) {
          entries = entries.filter((entry) => entry.id !== excludedId);
        }
        entries.sort((left, right) => left.id - right.id);
        return entries.map((entry) => ({ ...entry }));
      },
      async findUnique({ where }) {
        const entry = proxyEntries.find((candidate) => candidate.id === where.id);
        return entry ? { ...entry } : null;
      },
      async create({ data }) {
        const entry = { id: nextId++, ...data };
        proxyEntries.push(entry);
        return { ...entry };
      },
      async update({ where, data }) {
        const index = proxyEntries.findIndex((entry) => entry.id === where.id);
        if (index === -1) {
          throw new Error('missing proxy entry');
        }
        proxyEntries[index] = { ...proxyEntries[index], ...data };
        return { ...proxyEntries[index] };
      },
      async delete({ where }) {
        const index = proxyEntries.findIndex((entry) => entry.id === where.id);
        if (index === -1) {
          throw new Error('missing proxy entry');
        }
        const [deleted] = proxyEntries.splice(index, 1);
        return { ...deleted };
      },
    },
  };

  before(async () => {
    process.env.API_KEY = 'proxy-management-legacy-key';
    process.env.AUTH_JWT_SECRET = 'proxy-management-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';

    const moduleRef = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [
        AuthService,
        ProxyService,
        NginxService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: APP_GUARD,
          useClass: ApiKeyGuard,
        },
        {
          provide: APP_GUARD,
          useClass: AuthorizationGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    await app.init();
    httpServer = app.getHttpServer();
  });

  beforeEach(() => {
    proxyEntries = [createEntry()];
    nextId = 2;
  });

  after(async () => {
    if (app) {
      await app.close();
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('allows viewers to inspect proxies but blocks writes', async () => {
    const viewerToken = buildAdminToken('viewer');

    const listResponse = await request(httpServer)
      .get('/proxies')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(listResponse.body.count, 1);
    assert.deepEqual(listResponse.body.proxies[0].domains, ['app.example.com']);

    await request(httpServer)
      .post('/proxies')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        domains: ['new.example.com'],
        proxyPassHost: 'http://localhost:8080',
        type: 'PROXY',
        ssl: false,
      })
      .expect(403);
  });

  it('creates proxies for platform-admins and returns a reload hint', async () => {
    const platformAdminToken = buildAdminToken('platform-admin');

    const response = await request(httpServer)
      .post('/proxies')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        domains: ['api.example.com', 'www.api.example.com'],
        proxyPassHost: 'https://backend.internal:8443/app',
        type: 'PROXY',
        ssl: true,
        nginxCustomCode: 'add_header X-Managed-By "session-21" always;',
      })
      .expect(201);

    assert.equal(response.body.proxy.id, 2);
    assert.equal(response.body.proxy.proxyPassHost, 'https://backend.internal:8443/app');
    assert.equal(response.body.configChange.reloadRequired, true);
    assert.equal(
      response.body.configChange.suggestedOperationEndpoint,
      '/cluster/reload',
    );
    assert.match(response.body.validation.generatedConfigPreview, /server_name api.example.com www.api.example.com;/);
    assert.match(response.body.validation.generatedConfigPreview, /proxy_pass https:\/\/backend.internal:8443\/app;/);
    assert.equal(proxyEntries.length, 2);
  });

  it('rejects invalid proxy targets and overlapping domain ownership before persistence', async () => {
    const platformAdminToken = buildAdminToken('platform-admin');

    const invalidTarget = await request(httpServer)
      .post('/proxies')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        domains: ['invalid.example.com'],
        proxyPassHost: 'ftp://backend.internal/resource',
        type: 'PROXY',
        ssl: false,
      })
      .expect(400);

    assert.match(invalidTarget.body.message, /http or https scheme/i);
    assert.equal(proxyEntries.length, 1);

    const conflictingDomain = await request(httpServer)
      .post('/proxies')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        domains: ['app.example.com'],
        proxyPassHost: 'http://localhost:8080',
        type: 'PROXY',
        ssl: false,
      })
      .expect(400);

    assert.match(conflictingDomain.body.message, /already managed by proxy entry 1/i);
    assert.equal(proxyEntries.length, 1);
  });

  it('lets operators validate draft and stored proxy entries without mutating state', async () => {
    const operatorToken = buildAdminToken('operator');

    const draftValidation = await request(httpServer)
      .post('/proxies/validate')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        domains: ['*.preview.example.com'],
        proxyPassHost: '/maintenance',
        type: 'REDIRECT',
        ssl: true,
      })
      .expect(200);

    assert.equal(draftValidation.body.valid, true);
    assert.equal(draftValidation.body.normalizedEntry.type, 'REDIRECT');
    assert.equal(draftValidation.body.normalizedEntry.proxyPassHost, '/maintenance');
    assert.equal(draftValidation.body.warnings.length, 1);
    assert.match(draftValidation.body.warnings[0], /wildcard proxy domains/i);
    assert.equal(proxyEntries.length, 1);

    const storedValidation = await request(httpServer)
      .post('/proxies/1/validate')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    assert.equal(storedValidation.body.valid, true);
    assert.equal(storedValidation.body.normalizedEntry.id, 1);
  });

  it('updates proxies and can resolve upstream hostnames for operator diagnostics', async () => {
    const platformAdminToken = buildAdminToken('platform-admin');
    const operatorToken = buildAdminToken('operator');

    const updateResponse = await request(httpServer)
      .patch('/proxies/1')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        proxyPassHost: 'http://localhost:3000/service',
        nginxCustomCode: 'client_max_body_size 20m;',
      })
      .expect(200);

    assert.equal(updateResponse.body.proxy.proxyPassHost, 'http://localhost:3000/service');
    assert.match(updateResponse.body.validation.generatedConfigPreview, /client_max_body_size 20m;/);

    const upstreamResponse = await request(httpServer)
      .post('/proxies/1/test-upstream')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    assert.equal(upstreamResponse.body.ok, true);
    assert.equal(upstreamResponse.body.hostname, 'localhost');
    assert.ok(upstreamResponse.body.addresses.length >= 1);
  });

  it('deletes proxies only for platform-admins', async () => {
    const operatorToken = buildAdminToken('operator');
    const platformAdminToken = buildAdminToken('platform-admin');

    await request(httpServer)
      .delete('/proxies/1')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    const deleteResponse = await request(httpServer)
      .delete('/proxies/1')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    assert.equal(deleteResponse.body.deleted, true);
    assert.equal(deleteResponse.body.configChange.action, 'deleted');
    assert.equal(proxyEntries.length, 0);
  });
});

