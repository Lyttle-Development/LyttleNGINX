import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Configure connection pool to prevent connection leaks
    // Parse DATABASE_URL and add connection pool parameters if not present
    const databaseUrl = normalizePossiblyQuotedEnvValue(process.env.DATABASE_URL);
    if (databaseUrl) {
      const url = new URL(databaseUrl);
      const configuredPoolSize = Number.parseInt(
        url.searchParams.get('pool_size') || '',
        10,
      );
      const resolvedConnectionLimit =
        Number.isFinite(configuredPoolSize) && configuredPoolSize > 0
          ? String(configuredPoolSize)
          : '1';

      // Set connection pool limits if not already configured
      if (!url.searchParams.has('connection_limit')) {
        url.searchParams.set('connection_limit', resolvedConnectionLimit);
      }
      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '10'); // 10 second timeout
      }
      if (!url.searchParams.has('connect_timeout')) {
        url.searchParams.set('connect_timeout', '10'); // 10 second connect timeout
      }

      process.env.DATABASE_URL = url.toString();
    }

    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
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
    this.logger.log('[Prisma] Database connection closed');
  }
}
