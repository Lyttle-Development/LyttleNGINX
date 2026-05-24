require('reflect-metadata');

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const reloaderModulePath = path.join(repoRoot, 'src/reloader/reloader.service.ts');
const nginxServiceModulePath = path.join(repoRoot, 'src/nginx/nginx.service.ts');

const envKeys = ['NGINX_ETC_DIR', 'NGINX_SOURCE_DIR', 'NGINX_LOG_DIR', 'ADMIN_EMAIL'];
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadReloaderWithPaths(paths) {
  process.env.NGINX_ETC_DIR = paths.nginxEtcDir;
  process.env.NGINX_SOURCE_DIR = paths.nginxSourceDir;
  process.env.NGINX_LOG_DIR = paths.nginxLogDir;
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'session13@example.test';

  delete require.cache[require.resolve(reloaderModulePath)];
  delete require.cache[require.resolve(nginxServiceModulePath)];

  const { ReloaderService } = require(reloaderModulePath);
  const { NginxService } = require(nginxServiceModulePath);

  restoreEnv();

  return { ReloaderService, NginxService };
}

function createProxyEntry(overrides = {}) {
  return {
    id: overrides.id ?? 'proxy-1',
    domains: overrides.domains ?? 'example.test',
    proxy_pass_host: overrides.proxy_pass_host ?? 'http://localhost:8080',
    ssl: overrides.ssl ?? false,
    type: overrides.type ?? 'PROXY',
    nginx_custom_code: overrides.nginx_custom_code ?? '',
  };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createNginxSourceTree(rootDir) {
  await writeFile(
    path.join(rootDir, 'nginx.conf'),
    `pid /run/nginx.pid;

events {
    worker_connections 64;
}

http {
    include /etc/nginx/mime.types;
    root /etc/nginx/html;
    include /etc/nginx/runtime/current/conf.d/*.conf;
}
`,
  );
  await writeFile(path.join(rootDir, 'mime.types'), 'types { text/html html; }\n');
  await writeFile(
    path.join(rootDir, 'conf.d/default.conf'),
    `server {
    listen 80 default_server;
    root /etc/nginx/html;
    error_page 500 501 502 503 504 505 506 507 508 510 511 /errors/50x.html;
}
`,
  );
  await writeFile(path.join(rootDir, 'html/index.html'), '<html>ok</html>\n');
  await writeFile(path.join(rootDir, 'html/errors/5xx.html'), '<html>5xx</html>\n');
  await writeFile(
    path.join(rootDir, 'html/errors/broken.html'),
    '<html>broken</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/loading.html'),
    '<html>loading</html>\n',
  );
}

async function createHarness(overrides = {}) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lyttlenginx-session13-'),
  );
  const nginxEtcDir = path.join(tempDir, 'etc-nginx');
  const nginxSourceDir = path.join(tempDir, 'source-nginx');
  const nginxLogDir = path.join(tempDir, 'var-log-nginx');
  await createNginxSourceTree(nginxSourceDir);

  const { ReloaderService, NginxService } = loadReloaderWithPaths({
    nginxEtcDir,
    nginxSourceDir,
    nginxLogDir,
  });

  const entries = overrides.entries ?? [createProxyEntry()];
  const health = {
    successes: [],
    failures: [],
    recordConfigApplySuccess(message) {
      this.successes.push(message);
    },
    recordConfigApplyFailure(message) {
      this.failures.push(message);
    },
  };

  const service = new ReloaderService(
    {
      proxyEntry: {
        async findMany() {
          return entries;
        },
      },
    },
    new NginxService(),
    {
      ensuredDomains: [],
      async ensureCertificate(domains) {
        this.ensuredDomains.push(domains);
      },
    },
    {
      ensureCertbotWebroot() {},
    },
    health,
  );

  return {
    tempDir,
    nginxEtcDir,
    nginxSourceDir,
    health,
    service,
    cleanup: async () => {
      restoreEnv();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

afterEach(() => {
  restoreEnv();
});

describe('Session 13 transactional NGINX rollout', () => {
  it('validates staged releases before atomically promoting the current symlink', async () => {
    const harness = await createHarness();
    const commandCalls = [];

    harness.service.execCommand = async (command, args) => {
      commandCalls.push([command, ...args]);
      if (command === 'nginx' && args[0] === '-t') {
        return 'syntax ok';
      }
      if (command === 'nginx' && args[0] === '-s' && args[1] === 'reload') {
        return 'reload ok';
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    };

    try {
      const result = await harness.service.reloadConfig();
      const currentReleasePath = await fs.readlink(
        path.join(harness.nginxEtcDir, 'runtime/current'),
      );
      const lastKnownGoodPath = await fs.readlink(
        path.join(harness.nginxEtcDir, 'runtime/last-known-good'),
      );
      const metadata = JSON.parse(
        await fs.readFile(
          path.join(currentReleasePath, 'lyttle-nginx-release.json'),
          'utf8',
        ),
      );
      const generatedConfig = await fs.readFile(
        path.join(currentReleasePath, 'conf.d/proxy-1.conf'),
        'utf8',
      );
      const validationConfig = await fs.readFile(
        path.join(currentReleasePath, '.validation-nginx.conf'),
        'utf8',
      );

      assert.equal(result.ok, true);
      assert.notEqual(path.basename(currentReleasePath), 'bootstrap');
      assert.equal(currentReleasePath, lastKnownGoodPath);
      assert.equal(metadata.status, 'active');
      assert.equal(metadata.phase, 'ssl-activation');
      assert.match(metadata.validation.output, /syntax ok/);
      assert.match(
        generatedConfig,
        new RegExp(escapeRegExp(path.join(currentReleasePath, 'html/errors'))),
      );
      assert.match(
        validationConfig,
        new RegExp(escapeRegExp(path.join(currentReleasePath, 'conf.d'))),
      );
      assert.equal(
        commandCalls.filter((call) => call[0] === 'nginx' && call[1] === '-t')
          .length,
        2,
      );
      assert.equal(
        commandCalls.filter(
          (call) => call[0] === 'nginx' && call[1] === '-s' && call[2] === 'reload',
        ).length,
        2,
      );
      assert.equal(harness.health.failures.length, 0);
      assert.equal(harness.health.successes.length, 1);
      assert.match(harness.health.successes[0], new RegExp(path.basename(currentReleasePath)));
    } finally {
      await harness.cleanup();
    }
  });

  it('rolls back to the prior release when activation reload fails', async () => {
    const harness = await createHarness();
    let reloadAttempts = 0;

    harness.service.execCommand = async (command, args) => {
      if (command === 'nginx' && args[0] === '-t') {
        return 'syntax ok';
      }
      if (command === 'nginx' && args[0] === '-s' && args[1] === 'reload') {
        reloadAttempts += 1;
        if (reloadAttempts === 2) {
          throw new Error('reload failed after activation');
        }
        return 'reload ok';
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    };

    try {
      const result = await harness.service.reloadConfig();
      const currentReleasePath = await fs.readlink(
        path.join(harness.nginxEtcDir, 'runtime/current'),
      );
      const lastKnownGoodPath = await fs.readlink(
        path.join(harness.nginxEtcDir, 'runtime/last-known-good'),
      );
      const releaseNames = await fs.readdir(
        path.join(harness.nginxEtcDir, 'runtime/releases'),
      );
      const rolledBackReleaseName = releaseNames.find(
        (releaseName) =>
          releaseName !== 'bootstrap' &&
          releaseName !== path.basename(currentReleasePath),
      );
      const rolledBackMetadata = JSON.parse(
        await fs.readFile(
          path.join(
            harness.nginxEtcDir,
            'runtime/releases',
            rolledBackReleaseName,
            'lyttle-nginx-release.json',
          ),
          'utf8',
        ),
      );

      assert.equal(result.ok, false);
      assert.equal(currentReleasePath, lastKnownGoodPath);
      assert.equal(reloadAttempts, 3);
      assert.equal(rolledBackMetadata.status, 'rolled_back');
      assert.equal(
        rolledBackMetadata.rollback.rolledBackToReleaseId,
        path.basename(currentReleasePath),
      );
      assert.match(result.error ?? '', /rolled back to/);
      assert.equal(harness.health.successes.length, 0);
      assert.equal(harness.health.failures.length, 1);
    } finally {
      await harness.cleanup();
    }
  });

  it('keeps the stable loader and startup bootstrap wired to the managed runtime release path', async () => {
    const loaderConfig = await fs.readFile(
      path.join(repoRoot, 'nginx/nginx.conf'),
      'utf8',
    );
    const entrypoint = await fs.readFile(
      path.join(repoRoot, 'docker-entrypoint.sh'),
      'utf8',
    );

    assert.match(
      loaderConfig,
      /include \/etc\/nginx\/runtime\/current\/conf\.d\/\*\.conf;/,
    );
    assert.match(entrypoint, /bootstrap_nginx_runtime_layout\(\)/);
    assert.match(entrypoint, /NGINX_RUNTIME_CURRENT_LINK/);
    assert.match(entrypoint, /NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK/);
  });
});

