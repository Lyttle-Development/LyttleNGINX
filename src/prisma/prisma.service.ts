import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Configure connection pool to prevent connection leaks
    // Parse DATABASE_URL and add connection pool parameters if not present
    const databaseUrl = process.env.DATABASE_URL || '';
    const url = new URL(databaseUrl);

    // Set connection pool limits if not already configured
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1'); // Max 1 connection per instance
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '10'); // 10 second timeout
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '10'); // 10 second connect timeout
    }

    super({
      datasources: {
        db: {
          url: url.toString(),
        },
      },
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
