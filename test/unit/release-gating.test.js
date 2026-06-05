const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);
const workflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/main.yml'),
  'utf8',
);
const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const coverageGateScript = fs.readFileSync(
  path.join(repoRoot, 'scripts/ci/assert-coverage.js'),
  'utf8',
);

describe('CI/CD release gating', () => {
  it('adds explicit CI scripts and targeted overrides for release verification', () => {
    assert.equal(typeof packageJson.scripts['lint:ci'], 'string');
    assert.equal(typeof packageJson.scripts['test:coverage:ci'], 'string');
    assert.equal(typeof packageJson.scripts['audit:prod'], 'string');
    assert.equal(typeof packageJson.scripts['verify:ci'], 'string');

    assert.equal(packageJson.overrides['@hono/node-server'], '1.19.13');
    assert.equal(packageJson.overrides['@prisma/streams-local'].ajv, '8.20.0');
    assert.equal(packageJson.overrides['fast-uri'], '3.1.2');
  });

  it('keeps a dedicated coverage gate with explicit threshold environment variables', () => {
    assert.match(coverageGateScript, /COVERAGE_MIN_LINES/);
    assert.match(coverageGateScript, /COVERAGE_MIN_BRANCHES/);
    assert.match(coverageGateScript, /COVERAGE_MIN_FUNCTIONS/);
    assert.match(coverageGateScript, /all files\\s\*\\\|/);
    assert.match(coverageGateScript, /Coverage gate passed\./);
  });

  it('requires lint, typecheck, tests, dependency audit, and container scan before publishing', () => {
    assert.match(workflow, /^name: CI and Release Gates$/m);
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /workflow_dispatch:/);

    for (const jobName of [
      'lint:',
      'typecheck:',
      'tests:',
      'build:',
      'dependency-audit:',
      'container-scan:',
      'publish-image:',
    ]) {
      assert.match(workflow, new RegExp(`^  ${jobName}$`, 'm'));
    }

    assert.match(workflow, /Run CI lint gate[\s\S]*npm run lint:ci/);
    assert.match(workflow, /Run TypeScript typecheck[\s\S]*npm run typecheck/);
    assert.match(workflow, /Run tests with coverage gate[\s\S]*npm run test:coverage:ci/);
    assert.match(workflow, /Run production dependency audit[\s\S]*npm run audit:prod/);
    assert.match(workflow, /Scan container image with Trivy/);
    assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'/);
    assert.match(workflow, /uses: actions\/checkout@v6\.0\.3/);
    assert.match(workflow, /uses: actions\/setup-node@v6\.4\.0/);
    assert.match(workflow, /uses: docker\/build-push-action@v6/);
    assert.match(workflow, /uses: aquasecurity\/trivy-action@v0\.36\.0/);
    assert.match(workflow, /Build container image for scanning[\s\S]*pull: true/);
    assert.match(workflow, /Build and push API Docker image[\s\S]*pull: true/);

    assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(
      workflow,
      /needs:\n\s+- lint\n\s+- typecheck\n\s+- tests\n\s+- build\n\s+- dependency-audit\n\s+- container-scan/,
    );
    assert.match(workflow, /Build and push API Docker image/);
    assert.match(workflow, /ghcr\.io\/\$\{\{ github\.repository_owner }}\/lyttlenginx/);
  });

  it('runs the full verification contract during the Docker build before pruning dev dependencies', () => {
    assert.match(dockerfile, /RUN npm ci/);
    assert.match(dockerfile, /RUN npm run verify:ci/);
    assert.match(dockerfile, /RUN npm prune --omit=dev/);
    assert.match(dockerfile, /COPY \. \.\nRUN npm run verify:ci/);
    assert.match(dockerfile, /apt-get update && \\\n\s+apt-get dist-upgrade -y && \\\n\s+apt-get install -y --no-install-recommends/);
  });
});

