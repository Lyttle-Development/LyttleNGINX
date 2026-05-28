require('reflect-metadata');

const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const entrypointPath = path.join(repoRoot, 'docker-entrypoint.sh');
const reloaderModulePath = path.join(repoRoot, 'src/reloader/reloader.service.ts');
const nginxServiceModulePath = path.join(repoRoot, 'src/nginx/nginx.service.ts');
const certificateServicePath = path.join(repoRoot, 'src/certificate/certificate.service.ts');
const certificateOrderServicePath = path.join(
  repoRoot,
  'src/certificate/certificate-order.service.ts',
);

class PrismaService {}

const originalModuleLoad = Module._load;
Module._load = function loadWithPrismaStub(request, parent, isMain) {
  if (request === '../prisma/prisma.service') {
    return { PrismaService };
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

const { HealthService } = require('../../src/health/health.service');

Module._load = originalModuleLoad;

const {
  ClusterHeartbeatService,
} = require('../../src/distributed-lock/cluster-heartbeat.service');
const {
  ClusterOperationsService,
} = require('../../src/distributed-lock/cluster-operations.service');

const originalAccess = fsPromises.access;
const originalReadFile = fsPromises.readFile;
const originalKill = process.kill;
const originalFetch = global.fetch;
const originalAdminEmail = process.env.ADMIN_EMAIL;
const originalApiKey = process.env.API_KEY;
const originalConfigMaxAge = process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS;
const originalCertSyncMaxAge = process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS;
const originalExecFile = childProcess.execFile;

const reloaderEnvKeys = [
  'NGINX_ETC_DIR',
  'NGINX_SOURCE_DIR',
  'NGINX_LOG_DIR',
  'ADMIN_EMAIL',
];
const originalReloaderEnv = Object.fromEntries(
  reloaderEnvKeys.map((key) => [key, process.env[key]]),
);

function stubHealthyNginx(pid = 4242) {
  fsPromises.access = async () => undefined;
  fsPromises.readFile = async () => `${pid}\n`;
  process.kill = (targetPid, signal) => {
    assert.equal(targetPid, pid);
    assert.equal(signal, 0);
    return true;
  };
}

function restoreProcessAndFs() {
  fsPromises.access = originalAccess;
  fsPromises.readFile = originalReadFile;
  process.kill = originalKill;
}

function createNode(overrides = {}) {
  const now = new Date();

  return {
    id: overrides.id ?? `id-${overrides.instanceId ?? 'node-a'}`,
    hostname: overrides.hostname ?? overrides.instanceId ?? 'node-a',
    instanceId: overrides.instanceId ?? 'node-a',
    ipAddress: overrides.ipAddress ?? '10.0.0.1',
    isLeader: overrides.isLeader ?? false,
    lastHeartbeat: overrides.lastHeartbeat ?? now,
    version: overrides.version ?? '0.0.1',
    status: overrides.status ?? 'active',
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createLease({
  ownerNodeId,
  generation = 1,
  ttlSeconds = 30,
  expiresAt,
} = {}) {
  const now = new Date();
  const effectiveExpiresAt =
    expiresAt ?? new Date(now.getTime() + ttlSeconds * 1000);

  return {
    leaseName: 'cluster:leader',
    ownerNodeId: ownerNodeId ?? null,
    ownerHostname: ownerNodeId ?? null,
    generation,
    ttlSeconds,
    acquiredAt: now,
    renewedAt: now,
    expiresAt: effectiveExpiresAt,
    isExpired:
      ownerNodeId == null || effectiveExpiresAt.getTime() <= now.getTime(),
    isHeldByThisInstance: false,
    fencingToken: generation,
  };
}

function createClusterNodePrismaMock(initialNodes) {
  const state = {
    nodes: initialNodes.map((node) => ({ ...node })),
  };

  function matchesWhere(node, where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      const actual = node[key];

      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (Object.prototype.hasOwnProperty.call(expected, 'lt')) {
          return actual < expected.lt;
        }

        if (Object.prototype.hasOwnProperty.call(expected, 'not')) {
          return actual !== expected.not;
        }

        if (Object.prototype.hasOwnProperty.call(expected, 'in')) {
          return expected.in.includes(actual);
        }
      }

      return actual === expected;
    });
  }

  function sortNodes(nodes, orderBy) {
    if (!orderBy) {
      return nodes;
    }

    const [key, direction] = Object.entries(orderBy)[0];
    return nodes.slice().sort((left, right) => {
      const leftValue = left[key];
      const rightValue = right[key];

      if (leftValue < rightValue) {
        return direction === 'desc' ? 1 : -1;
      }

      if (leftValue > rightValue) {
        return direction === 'desc' ? -1 : 1;
      }

      return 0;
    });
  }

  function selectFields(node, select) {
    if (!select) {
      return { ...node };
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, include]) => include)
        .map(([key]) => [key, node[key]]),
    );
  }

  return {
    state,
    clusterNode: {
      async findMany({ where, orderBy, select } = {}) {
        const filtered = state.nodes.filter((node) => matchesWhere(node, where));
        return sortNodes(filtered, orderBy).map((node) => selectFields(node, select));
      },
      async findUnique({ where }) {
        const [key, value] = Object.entries(where)[0];
        const node = state.nodes.find((entry) => entry[key] === value);
        return node ? { ...node } : null;
      },
      async update({ where, data }) {
        const [key, value] = Object.entries(where)[0];
        const index = state.nodes.findIndex((node) => node[key] === value);

        if (index < 0) {
          throw new Error(`Node not found for ${key}=${value}`);
        }

        state.nodes[index] = {
          ...state.nodes[index],
          ...data,
          updatedAt: new Date(),
        };

        return { ...state.nodes[index] };
      },
      async updateMany({ where, data }) {
        let count = 0;
        state.nodes = state.nodes.map((node) => {
          if (!matchesWhere(node, where)) {
            return node;
          }

          count += 1;
          return {
            ...node,
            ...data,
            updatedAt: new Date(),
          };
        });

        return { count };
      },
      async deleteMany({ where }) {
        const before = state.nodes.length;
        state.nodes = state.nodes.filter((node) => !matchesWhere(node, where));
        return { count: before - state.nodes.length };
      },
      async count({ where } = {}) {
        return state.nodes.filter((node) => matchesWhere(node, where)).length;
      },
    },
  };
}

function createMutableDistributedLockMock({
  instanceId = 'node-a',
  lease = null,
  tryAcquire = false,
  acquire = false,
} = {}) {
  let currentLease = lease;
  const calls = {
    tryAcquireLeaderLock: 0,
    acquireLeaderLock: 0,
    releaseLeaderLock: 0,
  };

  function snapshot() {
    if (!currentLease) {
      return null;
    }

    const now = new Date();
    const isExpired =
      !currentLease.ownerNodeId || currentLease.expiresAt.getTime() <= now.getTime();

    return {
      ...currentLease,
      isExpired,
      isHeldByThisInstance: currentLease.ownerNodeId === instanceId && !isExpired,
      fencingToken: currentLease.generation,
    };
  }

  function assignLeaseToInstance() {
    currentLease = createLease({
      ownerNodeId: instanceId,
      generation: currentLease?.generation ? currentLease.generation + 1 : 1,
    });
  }

  return {
    calls,
    setLease(nextLease) {
      currentLease = nextLease;
    },
    getInstanceId() {
      return instanceId;
    },
    async isLeader() {
      const leaderLease = snapshot();
      return Boolean(
        leaderLease &&
          !leaderLease.isExpired &&
          leaderLease.ownerNodeId === instanceId,
      );
    },
    getLeaderLockStatus() {
      const leaderLease = snapshot();
      return {
        isLeader: Boolean(
          leaderLease &&
            !leaderLease.isExpired &&
            leaderLease.ownerNodeId === instanceId,
        ),
        instanceId,
        ownerNodeId: leaderLease?.ownerNodeId ?? null,
        generation: leaderLease?.generation ?? null,
        fencingToken: leaderLease?.generation ?? null,
        expiresAt: leaderLease?.expiresAt ?? null,
        heldForMs: leaderLease ? 1000 : null,
      };
    },
    async getLeaderLeaseSnapshot() {
      return snapshot();
    },
    async tryAcquireLeaderLock() {
      calls.tryAcquireLeaderLock += 1;
      if (!tryAcquire) {
        return false;
      }

      assignLeaseToInstance();
      return true;
    },
    async acquireLeaderLock() {
      calls.acquireLeaderLock += 1;
      if (!acquire) {
        return false;
      }

      assignLeaseToInstance();
      return true;
    },
    async releaseLeaderLock() {
      calls.releaseLeaderLock += 1;
      if (!currentLease || currentLease.ownerNodeId !== instanceId) {
        return false;
      }

      currentLease = createLease({
        ownerNodeId: null,
        generation: currentLease.generation,
        expiresAt: new Date(Date.now() - 1000),
      });
      return true;
    },
  };
}

function createOperationTarget(overrides = {}) {
  const now = new Date();

  return {
    id: overrides.id ?? `id-${overrides.instanceId ?? 'node-a'}`,
    hostname: overrides.hostname ?? overrides.instanceId ?? 'node-a',
    instanceId: overrides.instanceId ?? 'node-a',
    ipAddress: overrides.ipAddress ?? '10.0.0.1',
    isLeader: overrides.isLeader ?? false,
    lastHeartbeat: overrides.lastHeartbeat ?? now,
    version: overrides.version ?? '0.0.1',
    status: overrides.status ?? 'active',
    metadata:
      overrides.metadata ??
      {
        controlPlane: {
          baseUrl: `http://${overrides.hostname ?? overrides.instanceId ?? 'node-a'}.internal:3000`,
          address: `${overrides.hostname ?? overrides.instanceId ?? 'node-a'}.internal`,
          port: 3000,
          protocol: 'http',
        },
      },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createClusterOperationPrismaMock() {
  const state = {
    operationSequence: 0,
    ackSequence: 0,
    operations: [],
    acknowledgements: [],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getOperation(operationId) {
    return state.operations.find((operation) => operation.id === operationId) ?? null;
  }

  function getAcknowledgements(operationId) {
    return state.acknowledgements.filter((ack) => ack.operationId === operationId);
  }

  return {
    state,
    clusterOperation: {
      async create({ data }) {
        const now = new Date();
        state.operationSequence += 1;
        const operation = {
          id: `operation-${state.operationSequence}`,
          operationType: data.operationType,
          scope: data.scope ?? 'cluster',
          status: data.status ?? 'pending',
          initiatorNodeId: data.initiatorNodeId ?? null,
          initiatorHostname: data.initiatorHostname ?? null,
          initiatorActorId: data.initiatorActorId ?? null,
          initiatorActorType: data.initiatorActorType ?? null,
          initiatorActorDisplayName: data.initiatorActorDisplayName ?? null,
          correlationId: data.correlationId ?? null,
          requestPath: data.requestPath ?? null,
          targetNodeCount: data.targetNodeCount ?? 0,
          completedNodeCount: data.completedNodeCount ?? 0,
          successfulNodeCount: data.successfulNodeCount ?? 0,
          failedNodeCount: data.failedNodeCount ?? 0,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null,
          lastError: data.lastError ?? null,
          metadata: data.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        };

        state.operations.push(operation);

        for (const ackData of data.acknowledgements?.create ?? []) {
          state.ackSequence += 1;
          state.acknowledgements.push({
            id: `ack-${state.ackSequence}`,
            operationId: operation.id,
            nodeInstanceId: ackData.nodeInstanceId,
            nodeHostname: ackData.nodeHostname ?? null,
            endpointUrl: ackData.endpointUrl ?? null,
            status: ackData.status ?? 'pending',
            responseStatus: ackData.responseStatus ?? null,
            errorMessage: ackData.errorMessage ?? null,
            startedAt: ackData.startedAt ?? null,
            ackedAt: ackData.ackedAt ?? null,
            details: ackData.details ?? null,
            createdAt: now,
            updatedAt: now,
          });
        }

        return clone(operation);
      },
      async update({ where, data }) {
        const operation = getOperation(where.id);
        if (!operation) {
          throw new Error(`Operation not found: ${where.id}`);
        }

        Object.assign(operation, data, { updatedAt: new Date() });
        return clone(operation);
      },
      async findUniqueOrThrow({ where }) {
        const operation = getOperation(where.id);
        if (!operation) {
          throw new Error(`Operation not found: ${where.id}`);
        }

        return clone(operation);
      },
      async findUnique({ where, include }) {
        const operation = getOperation(where.id);
        if (!operation) {
          return null;
        }

        if (!include?.acknowledgements) {
          return clone(operation);
        }

        const acknowledgements = getAcknowledgements(where.id)
          .slice()
          .sort((left, right) =>
            `${left.nodeHostname ?? ''}:${left.nodeInstanceId}`.localeCompare(
              `${right.nodeHostname ?? ''}:${right.nodeInstanceId}`,
            ),
          );

        return {
          ...clone(operation),
          acknowledgements: clone(acknowledgements),
        };
      },
      async findMany({ take } = {}) {
        return state.operations
          .slice()
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, take ?? state.operations.length)
          .map(clone);
      },
    },
    clusterOperationAck: {
      async update({ where, data }) {
        const ack = state.acknowledgements.find(
          (entry) =>
            entry.operationId === where.operationId_nodeInstanceId.operationId &&
            entry.nodeInstanceId === where.operationId_nodeInstanceId.nodeInstanceId,
        );

        if (!ack) {
          throw new Error(
            `Acknowledgement not found for ${where.operationId_nodeInstanceId.operationId}/${where.operationId_nodeInstanceId.nodeInstanceId}`,
          );
        }

        Object.assign(ack, data, { updatedAt: new Date() });
        return clone(ack);
      },
      async findMany({ where, select } = {}) {
        const acknowledgements = state.acknowledgements.filter((ack) => {
          if (!where?.operationId) {
            return true;
          }
          return ack.operationId === where.operationId;
        });

        if (!select) {
          return acknowledgements.map(clone);
        }

        return acknowledgements.map((ack) => {
          const selected = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              selected[key] = ack[key];
            }
          }
          return selected;
        });
      },
    },
  };
}

async function waitForOperationToSettle(service, operationId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = await service.getOperation(operationId);
    if (operation && !['pending', 'running'].includes(operation.status)) {
      return operation;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Operation ${operationId} did not settle in time`);
}

function restoreReloaderEnv() {
  for (const key of reloaderEnvKeys) {
    if (originalReloaderEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalReloaderEnv[key];
    }
  }
}

function loadReloaderWithPaths(paths) {
  process.env.NGINX_ETC_DIR = paths.nginxEtcDir;
  process.env.NGINX_SOURCE_DIR = paths.nginxSourceDir;
  process.env.NGINX_LOG_DIR = paths.nginxLogDir;
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'session27@example.test';

  delete require.cache[require.resolve(reloaderModulePath)];
  delete require.cache[require.resolve(nginxServiceModulePath)];

  const { ReloaderService } = require(reloaderModulePath);
  const { NginxService } = require(nginxServiceModulePath);

  restoreReloaderEnv();

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
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, content, 'utf8');
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
    '<html lang="en">ok</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/5xx.html'),
    '<html lang="en">5xx</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/broken.html'),
    '<html lang="en">broken</html>\n',
  );
  await writeFile(
    path.join(rootDir, 'html/errors/loading.html'),
    '<html lang="en">loading</html>\n',
  );
}

async function createReloaderHarness(overrides = {}) {
  const tempDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'lyttlenginx-session27-reloader-'),
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
      async ensureCertificate() {
        return undefined;
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
    health,
    service,
    cleanup: async () => {
      restoreReloaderEnv();
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function writeExecutable(filePath, content) {
  await fsPromises.writeFile(filePath, content, { mode: 0o755 });
  await fsPromises.chmod(filePath, 0o755);
}

function collectProcessResult(child) {
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function readLog(logPath) {
  try {
    return await fsPromises.readFile(logPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function waitForResult(resultPromise, timeoutMs = 10000) {
  return Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for entrypoint to exit after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);
}

function stopIfRunning(child, signal = 'SIGKILL') {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

async function createEntrypointHarness(envOverrides = {}) {
  const tempDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'lyttlenginx-session27-entrypoint-'),
  );
  const binDir = path.join(tempDir, 'bin');
  const logPath = path.join(tempDir, 'process.log');
  await fsPromises.mkdir(binDir, { recursive: true });

  await writeExecutable(
    path.join(binDir, 'node'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-}" = "--version" ]; then
  echo "v24.16.0-test"
  exit 0
fi

if [ "\${1:-}" = "dist/main.js" ]; then
  echo "node:start" >> "$ENTRYPOINT_TEST_LOG"
  trap 'echo "node:term" >> "$ENTRYPOINT_TEST_LOG"; exit 0' TERM INT QUIT

  while true; do
    sleep 1
  done
fi

echo "unexpected node args: $*" >&2
exit 9
`,
  );

  await writeExecutable(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-}" = "--version" ]; then
  echo "11.15.0-test"
  exit 0
fi

echo "unexpected npm args: $*" >&2
exit 10
`,
  );

  await writeExecutable(
    path.join(binDir, 'npx'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-}" = "prisma" ] && [ "\${2:-}" = "generate" ]; then
  exit 0
fi

if [ "\${1:-}" = "prisma" ] && [ "\${2:-}" = "migrate" ] && [ "\${3:-}" = "deploy" ]; then
  exit 0
fi

echo "unexpected npx args: $*" >&2
exit 11
`,
  );

  await writeExecutable(
    path.join(binDir, 'nginx'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-}" = "-t" ]; then
  echo "nginx:test-ok" >> "$ENTRYPOINT_TEST_LOG"
  exit 0
fi

if [ "\${1:-}" = "-g" ] && [ "\${2:-}" = "daemon off;" ]; then
  echo "nginx:start" >> "$ENTRYPOINT_TEST_LOG"
  trap 'echo "nginx:quit" >> "$ENTRYPOINT_TEST_LOG"; exit 0' TERM INT QUIT

  if [ "\${FAKE_NGINX_MODE:-steady}" = "crash" ]; then
    sleep "\${FAKE_NGINX_CRASH_DELAY_SECONDS:-1}"
    echo "nginx:crash" >> "$ENTRYPOINT_TEST_LOG"
    exit "\${FAKE_NGINX_EXIT_CODE:-23}"
  fi

  while true; do
    sleep 1
  done
fi

if [ "\${1:-}" = "-s" ] && [ "\${2:-}" = "quit" ]; then
  echo "nginx:quit-command" >> "$ENTRYPOINT_TEST_LOG"
  exit 0
fi

echo "unexpected nginx args: $*" >&2
exit 12
`,
  );

  await writeExecutable(
    path.join(binDir, 'nc'),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
  );

  const child = spawn('/bin/bash', [entrypointPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DATABASE_URL: 'postgresql://user:pass@db:5432/lyttlenginx',
      HOSTNAME: 'session27-test-host',
      ENTRYPOINT_TEST_LOG: logPath,
      SERVICE_STARTUP_GRACE_SECONDS: '1',
      NODE_SHUTDOWN_TIMEOUT_SECONDS: '1',
      NGINX_SHUTDOWN_TIMEOUT_SECONDS: '1',
      DB_CONNECT_RETRY_DELAY_SECONDS: '1',
      MIGRATION_RETRY_DELAY_SECONDS: '1',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    child,
    logPath,
    resultPromise: collectProcessResult(child),
    cleanup: async () => {
      stopIfRunning(child);
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    },
  };
}

function resetCertificateModules() {
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(certificateOrderServicePath)];
}

function installExecFileStub(handler) {
  const calls = [];

  childProcess.execFile = (command, args, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    calls.push({ command, args: [...args], options: { ...options } });

    Promise.resolve()
      .then(() => handler({ command, args, options, calls }))
      .then((result) => callback?.(null, result?.stdout ?? '', result?.stderr ?? ''))
      .catch((error) => callback?.(error, '', error?.stderr ?? ''));

    return {
      stdin: {
        end() {},
      },
    };
  };

  return calls;
}

function restoreExecFile() {
  childProcess.execFile = originalExecFile;
}

function clone(value) {
  return structuredClone(value);
}

function applyDataPatch(record, data) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, 'increment')
    ) {
      record[key] = (record[key] ?? 0) + value.increment;
      continue;
    }

    record[key] = value;
  }
}

function createCertificatePrismaMock(clusterState) {
  const state = {
    certificateSequence: 0,
    orderSequence: 0,
    eventSequence: 0,
    artifactSequence: 0,
    certificates: [],
    orders: [],
    events: [],
    artifacts: [],
  };

  function getCertificate(where) {
    if (where.id) {
      return state.certificates.find((entry) => entry.id === where.id) ?? null;
    }

    if (where.domainsHash) {
      return (
        state.certificates.find((entry) => entry.domainsHash === where.domainsHash) ??
        null
      );
    }

    return null;
  }

  function getOrderById(id) {
    return state.orders.find((entry) => entry.id === id) ?? null;
  }

  function matchesArtifactWhere(artifact, where = {}) {
    if (typeof where.id === 'string' && artifact.id !== where.id) {
      return false;
    }
    if (where.orderId && artifact.orderId !== where.orderId) {
      return false;
    }
    if (where.domainsHash && artifact.domainsHash !== where.domainsHash) {
      return false;
    }
    if (where.isCurrent !== undefined && artifact.isCurrent !== where.isCurrent) {
      return false;
    }
    if (where.version?.lt !== undefined && !(artifact.version < where.version.lt)) {
      return false;
    }
    if (where.activatedAt?.not === null && artifact.activatedAt === null) {
      return false;
    }
    if (where.id?.not && artifact.id === where.id.not) {
      return false;
    }
    return true;
  }

  return {
    state,
    certificate: {
      async create({ data }) {
        state.certificateSequence += 1;
        const now = new Date();
        const certificate = {
          id: `cert-${state.certificateSequence}`,
          createdAt: now,
          updatedAt: now,
          failureReason: data.failureReason ?? null,
          retryAfter: data.retryAfter ?? null,
          failureCount: data.failureCount ?? 0,
          issuedByNode: data.issuedByNode ?? null,
          ...data,
        };
        state.certificates.push(certificate);
        return clone(certificate);
      },
      async findFirst() {
        return null;
      },
      async findUnique({ where }) {
        const certificate = getCertificate(where);
        return certificate ? clone(certificate) : null;
      },
      async update({ where, data }) {
        const certificate = getCertificate(where);
        if (!certificate) {
          throw new Error(`Certificate not found for update: ${JSON.stringify(where)}`);
        }
        applyDataPatch(certificate, data);
        certificate.updatedAt = new Date();
        return clone(certificate);
      },
      async findMany() {
        return state.certificates.map(clone);
      },
      async count() {
        return 0;
      },
      async delete() {
        return undefined;
      },
    },
    certificateOrder: {
      async create({ data }) {
        state.orderSequence += 1;
        const now = new Date();
        const order = {
          id: `order-${state.orderSequence}`,
          sourceType: data.sourceType ?? 'acme',
          status: data.status ?? 'requested',
          attemptCount: data.attemptCount ?? 1,
          retryCount: data.retryCount ?? 0,
          nextRetryAt: data.nextRetryAt ?? null,
          lastError: data.lastError ?? null,
          requestedByNode: data.requestedByNode ?? null,
          certificateId: data.certificateId ?? null,
          requestedAt: data.requestedAt ?? now,
          startedAt: data.startedAt ?? null,
          challengePublishedAt: data.challengePublishedAt ?? null,
          validatingAt: data.validatingAt ?? null,
          issuedAt: data.issuedAt ?? null,
          distributingAt: data.distributingAt ?? null,
          activatedAt: data.activatedAt ?? null,
          failedAt: data.failedAt ?? null,
          revokedAt: data.revokedAt ?? null,
          completedAt: data.completedAt ?? null,
          metadata: data.metadata ?? null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.orders.push(order);
        return clone(order);
      },
      async findFirst({ where, orderBy } = {}) {
        const results = state.orders.filter((order) => {
          if (where?.domainsHash && order.domainsHash !== where.domainsHash) {
            return false;
          }
          if (typeof where?.status === 'string' && order.status !== where.status) {
            return false;
          }
          if (where?.status?.in && !where.status.in.includes(order.status)) {
            return false;
          }
          if (where?.sourceType && order.sourceType !== where.sourceType) {
            return false;
          }
          if (
            where?.nextRetryAt?.lte &&
            !(order.nextRetryAt && order.nextRetryAt <= where.nextRetryAt.lte)
          ) {
            return false;
          }
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          results.sort((left, right) => right.createdAt - left.createdAt);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where, include, select } = {}) {
        const order = getOrderById(where.id);
        if (!order) {
          return null;
        }
        if (select) {
          const selected = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              selected[key] = order[key];
            }
          }
          return clone(selected);
        }
        if (!include) {
          return clone(order);
        }
        const record = clone(order);
        if (include.events) {
          record.events = state.events
            .filter((entry) => entry.orderId === order.id)
            .sort((left, right) => right.occurredAt - left.occurredAt)
            .map(clone);
        }
        if (include.artifacts) {
          record.artifacts = state.artifacts
            .filter((entry) => entry.orderId === order.id)
            .sort((left, right) => right.version - left.version)
            .map(clone);
        }
        return record;
      },
      async update({ where, data }) {
        const order = getOrderById(where.id);
        if (!order) {
          throw new Error(`Order not found for update: ${where.id}`);
        }
        applyDataPatch(order, data);
        order.updatedAt = new Date();
        return clone(order);
      },
      async findMany({ where, take } = {}) {
        return state.orders
          .filter((order) => {
            if (where?.sourceType && order.sourceType !== where.sourceType) {
              return false;
            }
            if (where?.status && order.status !== where.status) {
              return false;
            }
            if (
              where?.nextRetryAt?.lte &&
              !(order.nextRetryAt && order.nextRetryAt <= where.nextRetryAt.lte)
            ) {
              return false;
            }
            return true;
          })
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, take ?? state.orders.length)
          .map(clone);
      },
    },
    certificateOrderEvent: {
      async create({ data }) {
        state.eventSequence += 1;
        const event = {
          id: `event-${state.eventSequence}`,
          occurredAt: data.occurredAt ?? new Date(),
          details: data.details ?? null,
          ...data,
        };
        state.events.push(event);
        return clone(event);
      },
    },
    certificateArtifactVersion: {
      async findFirst({ where, orderBy } = {}) {
        const results = state.artifacts.filter((artifact) =>
          matchesArtifactWhere(artifact, where),
        );
        if (orderBy?.version === 'desc') {
          results.sort((left, right) => right.version - left.version);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        return artifact ? clone(artifact) : null;
      },
      async create({ data }) {
        state.artifactSequence += 1;
        const artifact = {
          id: `artifact-${state.artifactSequence}`,
          createdAt: new Date(),
          activatedAt: data.activatedAt ?? null,
          isCurrent: data.isCurrent ?? false,
          distributionStatus: data.distributionStatus ?? null,
          distributionOperationId: data.distributionOperationId ?? null,
          distributionCompletedAt: data.distributionCompletedAt ?? null,
          metadata: data.metadata ?? null,
          ...data,
        };
        state.artifacts.push(artifact);
        return clone(artifact);
      },
      async update({ where, data }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        if (!artifact) {
          throw new Error(`Artifact not found for update: ${where.id}`);
        }
        applyDataPatch(artifact, data);
        return clone(artifact);
      },
      async updateMany({ where, data }) {
        const matches = state.artifacts.filter((artifact) =>
          matchesArtifactWhere(artifact, where),
        );
        for (const artifact of matches) {
          applyDataPatch(artifact, data);
        }
        return { count: matches.length };
      },
    },
    clusterOperation: {
      async findUnique({ where }) {
        const operation =
          clusterState.operations.find((entry) => entry.id === where.id) ?? null;
        return operation ? clone(operation) : null;
      },
    },
    proxyEntry: {
      async findMany() {
        return [];
      },
    },
  };
}

function createCertificateHarness() {
  process.env.ADMIN_EMAIL = 'session27@example.test';
  resetCertificateModules();
  const { CertificateOrderService } = require(certificateOrderServicePath);
  const { CertificateService } = require(certificateServicePath);

  const clusterState = {
    sequence: 0,
    mode: 'succeeded',
    operations: [],
  };
  const prisma = createCertificatePrismaMock(clusterState);
  const orderService = new CertificateOrderService(prisma);
  const alertService = {
    sendAlert: async () => undefined,
  };
  const clusterOperations = {
    async enqueueBroadcastOperation(options) {
      clusterState.sequence += 1;
      const operationId = `op-${clusterState.sequence}`;
      await options.localAction(operationId);
      const operation =
        clusterState.mode === 'succeeded'
          ? {
              id: operationId,
              status: 'succeeded',
              completedAt: new Date(),
              acknowledgements: [
                {
                  nodeInstanceId: 'node-1',
                  nodeHostname: 'node-1',
                  endpointUrl: null,
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
                {
                  nodeInstanceId: 'node-2',
                  nodeHostname: 'node-2',
                  endpointUrl:
                    'http://node-2.internal:3000/certificates/artifacts/activate',
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
              ],
            }
          : {
              id: operationId,
              status: 'partially_failed',
              completedAt: new Date(),
              acknowledgements: [
                {
                  nodeInstanceId: 'node-1',
                  nodeHostname: 'node-1',
                  endpointUrl: null,
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
                {
                  nodeInstanceId: 'node-2',
                  nodeHostname: 'node-2',
                  endpointUrl:
                    'http://node-2.internal:3000/certificates/artifacts/activate',
                  status: 'failed',
                  responseStatus: 500,
                  errorMessage: 'node-2 failed activation',
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'failed' },
                },
              ],
            };
      clusterState.operations.push(operation);
      return { operationId };
    },
    async waitForOperationToSettle(operationId) {
      const operation =
        clusterState.operations.find((entry) => entry.id === operationId) ?? null;
      if (!operation) {
        throw new Error(`Unknown operation: ${operationId}`);
      }
      return clone(operation);
    },
  };
  const distributedLock = {
    getInstanceId: () => 'node-1',
    withLock: async (_name, fn) => fn(),
    acquireLeaderLock: async () => false,
    releaseLeaderLock: async () => undefined,
    releaseAllLocks: async () => undefined,
    isLeader: async () => false,
  };
  const healthService = {
    recordCertificateSyncFailure() {},
    recordCertificateSyncSuccess() {},
  };
  const service = new CertificateService(
    prisma,
    alertService,
    orderService,
    clusterOperations,
    distributedLock,
    healthService,
    null,
    undefined,
  );

  return { prisma, orderService, service, clusterState };
}

before(() => {
  process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS = '60000';
  process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS = '60000';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'session27@example.test';
});

after(() => {
  restoreProcessAndFs();
  restoreReloaderEnv();
  restoreExecFile();
  global.fetch = originalFetch;

  if (originalAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL;
  } else {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }

  if (originalApiKey === undefined) {
    delete process.env.API_KEY;
  } else {
    process.env.API_KEY = originalApiKey;
  }

  if (originalConfigMaxAge === undefined) {
    delete process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS;
  } else {
    process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS = originalConfigMaxAge;
  }

  if (originalCertSyncMaxAge === undefined) {
    delete process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS;
  } else {
    process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS = originalCertSyncMaxAge;
  }
});

afterEach(() => {
  restoreProcessAndFs();
  restoreReloaderEnv();
  restoreExecFile();
  global.fetch = originalFetch;
  resetCertificateModules();

  if (originalApiKey === undefined) {
    delete process.env.API_KEY;
  } else {
    process.env.API_KEY = originalApiKey;
  }

  process.env.ADMIN_EMAIL = 'session27@example.test';
});

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'session27@example.test';
});

describe('Session 27 chaos and fault-injection validation', () => {
  it('fails readiness decisively during a simulated database outage while keeping other dependencies visible', async () => {
    stubHealthyNginx(7272);

    const service = new HealthService({
      $queryRawUnsafe: async () => {
        throw new Error('connect ECONNREFUSED postgres:5432');
      },
    });

    service.recordConfigApplySuccess('release active');
    service.recordCertificateSyncSuccess('sync ok');

    const readiness = await service.ready();

    assert.equal(readiness.status, 'error');
    assert.equal(
      readiness.checks.find((check) => check.name === 'database')?.status,
      'error',
    );
    assert.match(
      readiness.checks.find((check) => check.name === 'database')?.details ?? '',
      /ECONNREFUSED postgres:5432/,
    );
    assert.equal(
      readiness.checks.find((check) => check.name === 'nginx_master')?.status,
      'ok',
    );
    assert.equal(
      readiness.checks.find((check) => check.name === 'config_apply')?.status,
      'ok',
    );
    assert.equal(
      readiness.checks.find((check) => check.name === 'certificate_sync')?.status,
      'ok',
    );
  });

  it('waits for a crashed leader lease to expire before electing a replacement and then recovers leadership', async () => {
    const prisma = createClusterNodePrismaMock([
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: false }),
      createNode({
        instanceId: 'node-b',
        hostname: 'node-b',
        status: 'stale',
        isLeader: true,
        lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000),
      }),
    ]);
    const distributedLock = createMutableDistributedLockMock({
      instanceId: 'node-a',
      lease: createLease({
        ownerNodeId: 'node-b',
        generation: 7,
        expiresAt: new Date(Date.now() + 30_000),
      }),
      tryAcquire: true,
    });
    const service = new ClusterHeartbeatService(prisma, distributedLock);

    await service.ensureLeaderExists();

    assert.equal(distributedLock.calls.tryAcquireLeaderLock, 0);
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-a')?.isLeader,
      false,
    );

    const stalledStats = await service.getClusterStats();
    assert.deepEqual(stalledStats.leadershipIssues, ['LEASE_OWNER_NOT_ACTIVE']);

    distributedLock.setLease(
      createLease({
        ownerNodeId: 'node-b',
        generation: 7,
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    await service.ensureLeaderExists();

    const recoveredLeader = await service.getLeaderNode();
    const recoveredStats = await service.getClusterStats();

    assert.equal(distributedLock.calls.tryAcquireLeaderLock, 1);
    assert.equal(recoveredLeader?.instanceId, 'node-a');
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-a')?.isLeader,
      true,
    );
    assert.equal(recoveredStats.leaderCount, 1);
    assert.deepEqual(recoveredStats.leadershipIssues, []);
    assert.equal(recoveredStats.leaderLeaseOwnerNodeId, 'node-a');
  });

  it('forces the container supervisor to exit non-zero when the NGINX master crashes', async () => {
    const harness = await createEntrypointHarness({
      FAKE_NGINX_MODE: 'crash',
      FAKE_NGINX_EXIT_CODE: '23',
      FAKE_NGINX_CRASH_DELAY_SECONDS: '1',
    });

    try {
      const result = await waitForResult(harness.resultPromise, 10000);
      const log = await readLog(harness.logPath);

      assert.equal(result.code, 23);
      assert.equal(result.signal, null);
      assert.match(log, /nginx:start/);
      assert.match(log, /node:start/);
      assert.match(log, /nginx:crash/);
      assert.match(log, /node:term/);
      assert.match(result.stderr, /NGINX exited unexpectedly with code 23/);
      assert.match(result.stdout, /Container supervision finished with exit code 23/);
    } finally {
      await harness.cleanup();
    }
  });

  it('rolls staged config activation back to the last-known-good release after an injected reload failure', async () => {
    const harness = await createReloaderHarness();
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
      const currentReleasePath = await fsPromises.readlink(
        path.join(harness.nginxEtcDir, 'runtime/current'),
      );
      const lastKnownGoodPath = await fsPromises.readlink(
        path.join(harness.nginxEtcDir, 'runtime/last-known-good'),
      );
      const releaseNames = await fsPromises.readdir(
        path.join(harness.nginxEtcDir, 'runtime/releases'),
      );
      const rolledBackReleaseName = releaseNames.find(
        (releaseName) =>
          releaseName !== 'bootstrap' &&
          releaseName !== path.basename(currentReleasePath),
      );
      const rolledBackMetadata = JSON.parse(
        await fsPromises.readFile(
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

  it('records node-communication failures as partial cluster-operation failures with per-node ACK detail', async () => {
    process.env.API_KEY = 'session27-peer-key';
    global.fetch = async () => {
      throw new Error('connect ETIMEDOUT node-b.internal:3000');
    };

    const prisma = createClusterOperationPrismaMock();
    const service = new ClusterOperationsService(
      prisma,
      {
        async getActiveNodes() {
          return [
            createOperationTarget({ instanceId: 'node-a', hostname: 'node-a' }),
            createOperationTarget({ instanceId: 'node-b', hostname: 'node-b' }),
          ];
        },
      },
      {
        getInstanceId() {
          return 'node-a';
        },
      },
    );

    const accepted = await service.enqueueBroadcastOperation({
      operationType: 'cluster.reload',
      remotePath: '/cluster/reload',
      remoteQuery: { broadcast: 'false' },
      executionTimeoutMs: 50,
      localAction: async () => ({ ok: true }),
      initiatedBy: {
        correlationId: 'corr-chaos-1',
        requestPath: '/cluster/reload?broadcast=true',
      },
    });

    const operation = await waitForOperationToSettle(service, accepted.operationId);
    const remoteAck = operation.acknowledgements.find(
      (ack) => ack.nodeInstanceId === 'node-b',
    );

    assert.equal(operation.status, 'partially_failed');
    assert.equal(operation.successfulNodeCount, 1);
    assert.equal(operation.failedNodeCount, 1);
    assert.equal(remoteAck?.status, 'failed');
    assert.match(remoteAck?.errorMessage ?? '', /ETIMEDOUT node-b\.internal:3000/);
    assert.match(remoteAck?.endpointUrl ?? '', /\/cluster\/reload\?broadcast=false&operationId=/);
  });

  it('keeps the previously active certificate artifact current when a new cluster activation partially fails', async () => {
    let certificateSequence = 0;
    installExecFileStub(async ({ command, args }) => {
      if (command === 'nginx') {
        return { stdout: '' };
      }

      assert.equal(command, 'openssl');

      if (args[0] === 'genrsa') {
        fs.writeFileSync(
          args[2],
          `-----BEGIN PRIVATE KEY-----\nkey-${certificateSequence + 1}\n-----END PRIVATE KEY-----\n`,
        );
        return { stdout: '' };
      }

      if (args[0] === 'req') {
        certificateSequence += 1;
        const outIndex = args.indexOf('-out');
        fs.writeFileSync(
          args[outIndex + 1],
          `-----BEGIN CERTIFICATE-----\nversion-${certificateSequence}\n-----END CERTIFICATE-----\n`,
        );
        return { stdout: '' };
      }

      if (args[0] === 'x509' && args.includes('-pubkey')) {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'pkey') {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'x509' && args.includes('-enddate')) {
        return { stdout: 'notAfter=Jan  1 00:00:00 2035 GMT\n' };
      }

      if (args[0] === 'x509' && args.includes('-text')) {
        return {
          stdout: `Certificate Data\nX509v3 Subject Alternative Name:\n    DNS:example.com\n`,
        };
      }

      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    const { prisma, orderService, service, clusterState } = createCertificateHarness();
    service.writeCertToFs = () => undefined;

    const initialCertificate = await service.generateSelfSignedCertificate(['example.com']);

    clusterState.mode = 'partially_failed';

    await assert.rejects(
      () => service.generateSelfSignedCertificate(['example.com']),
      /node-2 failed activation/,
    );

    const failedOrders = await orderService.listOrders();
    const failedOrder = await orderService.getOrder(failedOrders.orders[0].id);
    const currentArtifacts = prisma.state.artifacts.filter((artifact) => artifact.isCurrent);
    const latestArtifact = prisma.state.artifacts.reduce((latest, artifact) =>
      !latest || artifact.version > latest.version ? artifact : latest,
    null);
    const certificateRecord = prisma.state.certificates[0];

    assert.equal(initialCertificate.id, certificateRecord.id);
    assert.equal(failedOrder.status, 'failed');
    assert.equal(currentArtifacts.length, 1);
    assert.equal(currentArtifacts[0].version, 1);
    assert.equal(latestArtifact.version, 2);
    assert.equal(latestArtifact.distributionStatus, 'partially_failed');
    assert.equal(latestArtifact.isCurrent, false);
    assert.match(certificateRecord.certPem, /version-1/);
    assert.equal(certificateSequence, 2);
  });
});

