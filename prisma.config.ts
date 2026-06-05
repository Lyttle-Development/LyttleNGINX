import { defineConfig } from 'prisma/config';

const DATABASE_URL_FALLBACK =
  'postgresql://postgres:postgres@127.0.0.1:5432/lyttle_nginx?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || DATABASE_URL_FALLBACK,
  },
});
