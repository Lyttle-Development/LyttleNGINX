require('reflect-metadata');

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const customCodeModulePath = path.join(
  repoRoot,
  'src/nginx/nginx-custom-code.ts',
);
const nginxServiceModulePath = path.join(repoRoot, 'src/nginx/nginx.service.ts');
const reloaderModulePath = path.join(repoRoot, 'src/reloader/reloader.service.ts');

const envKeys = [
  'ADMIN_EMAIL',
  'NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES',
  'NGINX_ETC_DIR',
  'NGINX_LOG_DIR',
  'NGINX_SOURCE_DIR',
];
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
  await writeFile(
    path.join(rootDir, 'html/index.html'),
    '<!doctype html><html lang="en">ok</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/5xx.html'),
    '<!doctype html><html lang="en">5xx</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/broken.html'),
    '<!doctype html><html lang="en">broken</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/loading.html'),
    '<!doctype html><html lang="en">loading</html>\n',
  );
}

function loadCustomCodeModule() {
  delete require.cache[require.resolve(customCodeModulePath)];
  return require(customCodeModulePath);
}

function loadNginxServiceModule() {
  delete require.cache[require.resolve(customCodeModulePath)];
  delete require.cache[require.resolve(nginxServiceModulePath)];
  return require(nginxServiceModulePath);
}

function loadReloaderWithPaths(paths) {
  process.env.NGINX_ETC_DIR = paths.nginxEtcDir;
  process.env.NGINX_SOURCE_DIR = paths.nginxSourceDir;
  process.env.NGINX_LOG_DIR = paths.nginxLogDir;
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'nginx-custom-code@example.test';

  delete require.cache[require.resolve(customCodeModulePath)];
  delete require.cache[require.resolve(nginxServiceModulePath)];
  delete require.cache[require.resolve(reloaderModulePath)];

  const { ReloaderService } = require(reloaderModulePath);
  const { NginxService } = require(nginxServiceModulePath);

  restoreEnv();

  return { ReloaderService, NginxService };
}

async function createReloadHarness(entries) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lyttlenginx-nginx-custom-code-'),
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
      async ensureCertificate() {},
    },
    {
      ensureCertbotWebroot() {},
    },
    health,
  );

  return {
    health,
    service,
    tempDir,
    cleanup: async () => {
      restoreEnv();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

afterEach(() => {
  restoreEnv();
});

describe('nginx_custom_code guardrails', () => {
  it('sanitizes allowlisted custom fragments and reuses their managed paths safely', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lyttlenginx-nginx-custom-code-allowed-'),
    );
    const allowedRoot = path.join(tempDir, 'allowed-static');
    process.env.NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES = allowedRoot;

    try {
      const { sanitizeNginxCustomCode, extractManagedPathsFromCustomCode } =
        loadCustomCodeModule();
      const { NginxService } = loadNginxServiceModule();

      const fragment = `
        location ^~ /assets/ {
          root ${allowedRoot};
          try_files $uri =404;
          add_header Cache-Control "public, max-age=3600" always;
        }
        add_header X-Frame-Options DENY always;
        client_max_body_size 10m;
      `;

      const sanitized = sanitizeNginxCustomCode(fragment);
      const managedPaths = extractManagedPathsFromCustomCode(fragment);
      const config = new NginxService().generateNginxConfig([
        createProxyEntry({ nginx_custom_code: fragment }),
      ]);

      assert.match(sanitized, new RegExp('^ {2}location \\^~ \/assets\/', 'm'));
      assert.match(sanitized, /root .*allowed-static;/);
      assert.match(sanitized, /add_header Cache-Control "public, max-age=3600" always;/);
      assert.deepEqual(managedPaths, [allowedRoot]);
      assert.match(config, /location \^~ \/assets\//);
      assert.match(config, /client_max_body_size 10m;/);
      assert.doesNotMatch(config, /#.*allowed-static/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects dangerous directives instead of injecting them into generated server blocks', () => {
    const { sanitizeNginxCustomCode } = loadCustomCodeModule();

    assert.throws(
      () =>
        sanitizeNginxCustomCode(`
          location /private/ {
            proxy_pass http://attacker.internal;
          }
        `),
      /directive "proxy_pass" is not allowed/i,
    );
  });

  it('rejects managed paths outside the allowlisted prefixes', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lyttlenginx-nginx-custom-code-prefix-'),
    );
    process.env.NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES = path.join(
      tempDir,
      'approved-root',
    );

    try {
      const { sanitizeNginxCustomCode } = loadCustomCodeModule();

      assert.throws(
        () =>
          sanitizeNginxCustomCode(`
            location /downloads/ {
              alias ${path.join(tempDir, 'unapproved-root')};
            }
          `),
        /must stay within one of/i,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails the staged reload before nginx validation when a custom fragment is invalid', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lyttlenginx-nginx-custom-code-reload-'),
    );
    process.env.NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES = path.join(
      tempDir,
      'allowed-static',
    );

    const harness = await createReloadHarness([
      createProxyEntry({
        nginx_custom_code: `
          location /private/ {
            proxy_pass http://attacker.internal;
          }
        `,
      }),
    ]);
    const commandCalls = [];

    harness.service.execCommand = async (command, args) => {
      commandCalls.push([command, ...args]);
      return 'unexpected';
    };

    try {
      const result = await harness.service.reloadConfig();

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /proxy_pass/);
      assert.equal(commandCalls.length, 0);
      assert.equal(harness.health.successes.length, 0);
      assert.equal(harness.health.failures.length, 1);
      assert.match(harness.health.failures[0], /proxy_pass/);
    } finally {
      await harness.cleanup();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

