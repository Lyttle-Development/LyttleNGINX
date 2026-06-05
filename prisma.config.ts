// @ts-nocheck
import { defineConfig } from 'prisma/config';
import * as process from 'node:process';

const DATABASE_URL_FALLBACK =
  'postgresql://postgres:postgres@127.0.0.1:5432/lyttle_nginx?schema=public';

function normalizePossiblyQuotedEnvValue(value: string | undefined): string | undefined {
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

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      normalizePossiblyQuotedEnvValue(process.env['DATABASE_URL']) ||
      DATABASE_URL_FALLBACK,
  },
});
