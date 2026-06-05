import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool, type PoolConfig } from 'pg';

type PrismaClientOptions = ConstructorParameters<typeof PrismaClient>[0];

const DATABASE_URL_FALLBACK =
  'postgresql://postgres:postgres@127.0.0.1:5432/lyttle_nginx?schema=public';

function normalizePossiblyQuotedEnvValue(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }

  return trimmed;
}

function parsePositiveInteger(
  value: string | null | undefined,
): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolvePgSslOption(
  sslMode: string | null,
): PoolConfig['ssl'] | undefined {
  if (!sslMode) {
    return undefined;
  }

  switch (sslMode.toLowerCase()) {
    case 'disable':
    case 'allow':
    case 'prefer':
      return false;
    case 'no-verify':
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}

function createPrismaRuntimeConfiguration(): {
  clientOptions: PrismaClientOptions;
  pool?: Pool;
} {
  const baseClientOptions: PrismaClientOptions = {
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  };

  const databaseUrl =
    normalizePossiblyQuotedEnvValue(process.env['DATABASE_URL']) ||
    DATABASE_URL_FALLBACK;

  const prismaUrl = new URL(databaseUrl);
  const configuredPoolSize =
    parsePositiveInteger(prismaUrl.searchParams.get('connection_limit')) ??
    parsePositiveInteger(prismaUrl.searchParams.get('pool_size')) ??
    1;

  if (!prismaUrl.searchParams.has('connection_limit')) {
    prismaUrl.searchParams.set('connection_limit', String(configuredPoolSize));
  }
  if (!prismaUrl.searchParams.has('pool_timeout')) {
    prismaUrl.searchParams.set('pool_timeout', '10');
  }
  if (!prismaUrl.searchParams.has('connect_timeout')) {
    prismaUrl.searchParams.set('connect_timeout', '10');
  }

  process.env['DATABASE_URL'] = prismaUrl.toString();

  const adapterUrl = new URL(prismaUrl.toString());
  const schema = adapterUrl.searchParams.get('schema') || 'public';
  const connectionTimeoutSeconds = parsePositiveInteger(
    adapterUrl.searchParams.get('connect_timeout'),
  );
  const ssl = resolvePgSslOption(adapterUrl.searchParams.get('sslmode'));

  for (const searchParam of [
    'connection_limit',
    'pool_size',
    'pool_timeout',
    'schema',
    'sslmode',
  ]) {
    adapterUrl.searchParams.delete(searchParam);
  }

  const poolConfig: PoolConfig = {
    connectionString: adapterUrl.toString(),
    max: configuredPoolSize,
  };

  if (connectionTimeoutSeconds) {
    poolConfig.connectionTimeoutMillis = connectionTimeoutSeconds * 1000;
  }

  if (ssl !== undefined) {
    poolConfig.ssl = ssl;
  }

  const pool = new Pool(poolConfig);
  const adapter = new PrismaPg(pool, {
    schema,
    disposeExternalPool: false,
  });

  return {
    pool,
    clientOptions: {
      ...baseClientOptions,
      adapter,
    },
  };
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool?: Pool;

  constructor() {
    const { clientOptions, pool } = createPrismaRuntimeConfiguration();

    super(clientOptions);

    this.pool = pool;

    this.pool?.on('error', (error) => {
      this.logger.error(`[Prisma][Pool] ${error.message}`, error.stack);
    });

    // Log connection pool warnings
    this.$on('warn' as never, (e: any) => {
      this.logger.warn(`[Prisma] ${e.message}`);
    });

    this.$on('error' as never, (e: any) => {
      this.logger.error(`[Prisma] ${e.message}`);
    });
  }

  async onModuleInit() {
    this.logger.log(
      '[Prisma] Connecting to database with connection pooling...',
    );
    await this.$connect();
    this.logger.log('[Prisma] Database connection established');
  }

  async onModuleDestroy() {
    this.logger.log('[Prisma] Disconnecting from database...');
    await this.$disconnect();
    if (this.pool) {
      await this.pool.end();
    }
    this.logger.log('[Prisma] Database connection closed');
  }
}
