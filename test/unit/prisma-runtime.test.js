require('reflect-metadata');

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const prismaServiceModulePath = path.join(
  repoRoot,
  'src/prisma/prisma.service.ts',
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalLoad = Module._load;

function resetPrismaServiceModule() {
  delete require.cache[require.resolve(prismaServiceModulePath)];
}

function loadPrismaServiceWithStubs() {
  const state = {
    poolConfigs: [],
    pools: [],
    adapters: [],
    clientOptions: [],
    connectCalls: 0,
    disconnectCalls: 0,
  };

  class PoolStub extends EventEmitter {
    constructor(config) {
      super();
      this.config = { ...config };
      this.endCalls = 0;
      state.poolConfigs.push(this.config);
      state.pools.push(this);
    }

    async end() {
      this.endCalls += 1;
    }
  }

  class PrismaPgStub {
    constructor(pool, options) {
      this.pool = pool;
      this.options = { ...options };
      state.adapters.push({
        instance: this,
        pool,
        options: this.options,
      });
    }
  }

  class PrismaClientStub {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      state.clientOptions.push(options);
    }

    $on(event, handler) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    emitPrismaEvent(event, payload) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }

    async $connect() {
      state.connectCalls += 1;
    }

    async $disconnect() {
      state.disconnectCalls += 1;
    }
  }

  Module._load = function loadWithPrismaRuntimeStubs(request, parent, isMain) {
    if (request === 'pg') {
      return { Pool: PoolStub };
    }

    if (request === '@prisma/adapter-pg') {
      return { PrismaPg: PrismaPgStub };
    }

    if (request === '@prisma/client') {
      return { PrismaClient: PrismaClientStub };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    resetPrismaServiceModule();
    const moduleExports = require(prismaServiceModulePath);
    return {
      PrismaService: moduleExports.PrismaService,
      state,
    };
  } finally {
    Module._load = originalLoad;
  }
}

afterEach(() => {
  resetPrismaServiceModule();
  Module._load = originalLoad;

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe('PrismaService runtime configuration', () => {
  it('normalizes quoted urls, builds the pg adapter, logs events, and shuts down the pool', async () => {
    process.env.DATABASE_URL =
      '  "postgresql://user:pass@db.example.test:5432/app?pool_size=5&schema=tenant_a&sslmode=no-verify"  ';

    const { PrismaService, state } = loadPrismaServiceWithStubs();
    const service = new PrismaService();
    const logs = {
      log: [],
      warn: [],
      error: [],
    };

    service.logger.log = (...args) => logs.log.push(args);
    service.logger.warn = (...args) => logs.warn.push(args);
    service.logger.error = (...args) => logs.error.push(args);

    const normalizedRuntimeUrl = new URL(process.env.DATABASE_URL);
    assert.equal(normalizedRuntimeUrl.protocol, 'postgresql:');
    assert.equal(normalizedRuntimeUrl.hostname, 'db.example.test');
    assert.equal(normalizedRuntimeUrl.port, '5432');
    assert.equal(normalizedRuntimeUrl.username, 'user');
    assert.equal(normalizedRuntimeUrl.password, 'pass');
    assert.equal(normalizedRuntimeUrl.searchParams.get('pool_size'), '5');
    assert.equal(normalizedRuntimeUrl.searchParams.get('connection_limit'), '5');
    assert.equal(normalizedRuntimeUrl.searchParams.get('pool_timeout'), '10');
    assert.equal(normalizedRuntimeUrl.searchParams.get('connect_timeout'), '10');

    assert.equal(state.poolConfigs.length, 1);
    assert.equal(state.adapters.length, 1);
    assert.equal(state.clientOptions.length, 1);

    const poolConfig = state.poolConfigs[0];
    const adapter = state.adapters[0];
    const adapterUrl = new URL(poolConfig.connectionString);

    assert.equal(poolConfig.max, 5);
    assert.equal(poolConfig.connectionTimeoutMillis, 10_000);
    assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: false });
    assert.equal(adapter.options.schema, 'tenant_a');
    assert.equal(adapter.options.disposeExternalPool, false);
    assert.equal(adapter.pool, state.pools[0]);
    assert.equal(state.clientOptions[0].adapter, adapter.instance);
    assert.deepEqual(state.clientOptions[0].log, [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ]);

    assert.equal(adapterUrl.searchParams.get('pool_size'), null);
    assert.equal(adapterUrl.searchParams.get('connection_limit'), null);
    assert.equal(adapterUrl.searchParams.get('pool_timeout'), null);
    assert.equal(adapterUrl.searchParams.get('schema'), null);
    assert.equal(adapterUrl.searchParams.get('sslmode'), null);
    assert.equal(adapterUrl.searchParams.get('connect_timeout'), '10');

    state.pools[0].emit('error', new Error('pool became unavailable'));
    service.emitPrismaEvent('warn', { message: 'query exceeded threshold' });
    service.emitPrismaEvent('error', { message: 'adapter error surfaced' });

    assert.equal(logs.warn[0][0], '[Prisma] query exceeded threshold');
    assert.equal(logs.error[0][0], '[Prisma][Pool] pool became unavailable');
    assert.equal(logs.error[1][0], '[Prisma] adapter error surfaced');

    await service.onModuleInit();
    await service.onModuleDestroy();

    assert.equal(state.connectCalls, 1);
    assert.equal(state.disconnectCalls, 1);
    assert.equal(state.pools[0].endCalls, 1);
    assert.deepEqual(logs.log.map((entry) => entry[0]), [
      '[Prisma] Connecting to database with connection pooling...',
      '[Prisma] Database connection established',
      '[Prisma] Disconnecting from database...',
      '[Prisma] Database connection closed',
    ]);
  });

  it('falls back to the local database url and maps alternate ssl modes predictably', () => {
    delete process.env.DATABASE_URL;

    const { PrismaService, state } = loadPrismaServiceWithStubs();
    const fallbackService = new PrismaService();
    const fallbackRuntimeUrl = new URL(process.env.DATABASE_URL);

    assert.equal(fallbackRuntimeUrl.hostname, '127.0.0.1');
    assert.equal(fallbackRuntimeUrl.pathname, '/lyttle_nginx');
    assert.equal(fallbackRuntimeUrl.searchParams.get('schema'), 'public');
    assert.equal(fallbackRuntimeUrl.searchParams.get('connection_limit'), '1');
    assert.equal(fallbackRuntimeUrl.searchParams.get('pool_timeout'), '10');
    assert.equal(fallbackRuntimeUrl.searchParams.get('connect_timeout'), '10');
    assert.equal(state.poolConfigs[0].max, 1);
    assert.equal(state.poolConfigs[0].connectionTimeoutMillis, 10_000);
    assert.equal('ssl' in state.poolConfigs[0], false);
    assert.equal(state.adapters[0].options.schema, 'public');

    process.env.DATABASE_URL =
      'postgresql://user:pass@db.example.test:5432/app?connection_limit=2&connect_timeout=4&sslmode=verify-full';
    const verifiedService = new PrismaService();
    assert.equal(state.poolConfigs[1].max, 2);
    assert.equal(state.poolConfigs[1].connectionTimeoutMillis, 4_000);
    assert.deepEqual(state.poolConfigs[1].ssl, { rejectUnauthorized: true });

    process.env.DATABASE_URL =
      'postgresql://user:pass@db.example.test:5432/app?pool_size=3&sslmode=disable';
    const disabledService = new PrismaService();
    assert.equal(state.poolConfigs[2].max, 3);
    assert.equal(state.poolConfigs[2].connectionTimeoutMillis, 10_000);
    assert.equal(state.poolConfigs[2].ssl, false);

    process.env.DATABASE_URL =
      'postgresql://user:pass@db.example.test:5432/app?pool_size=7&sslmode=unexpected';
    const unknownSslService = new PrismaService();
    assert.equal(state.poolConfigs[3].max, 7);
    assert.equal('ssl' in state.poolConfigs[3], false);

    assert.ok(fallbackService);
    assert.ok(verifiedService);
    assert.ok(disabledService);
    assert.ok(unknownSslService);
  });
});

