const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const {
  normalizePossiblyQuotedEnvValue,
} = require('../../src/utils/env-utils');

describe('environment value normalization', () => {
  it('strips matching wrapping quotes and surrounding whitespace', () => {
    assert.equal(
      normalizePossiblyQuotedEnvValue('  "postgresql://user:pass@db:5432/app?schema=public"  '),
      'postgresql://user:pass@db:5432/app?schema=public',
    );
    assert.equal(
      normalizePossiblyQuotedEnvValue("  'postgresql://user:pass@db:5432/app?schema=public'  "),
      'postgresql://user:pass@db:5432/app?schema=public',
    );
  });

  it('preserves already clean values and collapses empty input to undefined', () => {
    assert.equal(
      normalizePossiblyQuotedEnvValue('postgresql://user:pass@db:5432/app?schema=public'),
      'postgresql://user:pass@db:5432/app?schema=public',
    );
    assert.equal(normalizePossiblyQuotedEnvValue('   '), undefined);
    assert.equal(normalizePossiblyQuotedEnvValue(undefined), undefined);
  });

  it('keeps Prisma and entrypoint wired to normalize DATABASE_URL before use', async () => {
    const prismaConfig = await fs.readFile(
      path.join(repoRoot, 'prisma.config.ts'),
      'utf8',
    );
    const prismaService = await fs.readFile(
      path.join(repoRoot, 'src/prisma/prisma.service.ts'),
      'utf8',
    );
    const entrypoint = await fs.readFile(
      path.join(repoRoot, 'docker-entrypoint.sh'),
      'utf8',
    );

    assert.match(prismaConfig, /normalizePossiblyQuotedEnvValue/);
    assert.match(prismaService, /normalizePossiblyQuotedEnvValue/);
    assert.match(entrypoint, /normalize_quoted_env_value/);
    assert.match(entrypoint, /DATABASE_URL contained wrapping quotes; normalizing it/);
  });
});

