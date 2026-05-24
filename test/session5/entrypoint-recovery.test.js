const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const entrypointPath = path.join(repoRoot, 'docker-entrypoint.sh');

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
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
    return await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function waitForLogEntries(logPath, expectedEntries, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const log = await readLog(logPath);
    if (expectedEntries.every((entry) => log.includes(entry))) {
      return log;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Timed out waiting for log entries: ${expectedEntries.join(', ')}\nCurrent log:\n${await readLog(logPath)}`,
  );
}

async function waitForResult(processResultPromise, timeoutMs = 10000) {
  return Promise.race([
    processResultPromise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for entrypoint to exit after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function stopIfRunning(child, signal = 'SIGKILL') {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

async function createHarness(envOverrides = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyttlenginx-session5-'));
  const binDir = path.join(tempDir, 'bin');
  const logPath = path.join(tempDir, 'process.log');
  await fs.mkdir(binDir, { recursive: true });

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

  if [ "\${FAKE_NODE_MODE:-steady}" = "crash" ]; then
    sleep "\${FAKE_NODE_CRASH_DELAY_SECONDS:-1}"
    echo "node:crash" >> "$ENTRYPOINT_TEST_LOG"
    exit "\${FAKE_NODE_EXIT_CODE:-37}"
  fi

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
  echo "npx:prisma-generate" >> "$ENTRYPOINT_TEST_LOG"
  exit 0
fi

if [ "\${1:-}" = "prisma" ] && [ "\${2:-}" = "migrate" ] && [ "\${3:-}" = "deploy" ]; then
  echo "npx:prisma-migrate-deploy" >> "$ENTRYPOINT_TEST_LOG"
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
      HOSTNAME: 'session5-test-host',
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
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

describe('Session 5 entrypoint recovery behavior', () => {
  it('exits non-zero and tears down NGINX when the Node process crashes', async () => {
    const harness = await createHarness({
      FAKE_NODE_MODE: 'crash',
      FAKE_NODE_EXIT_CODE: '37',
      FAKE_NODE_CRASH_DELAY_SECONDS: '1',
    });

    try {
      const result = await waitForResult(harness.resultPromise, 10000);
      const log = await readLog(harness.logPath);

      assert.equal(result.code, 37);
      assert.equal(result.signal, null);
      assert.match(log, /nginx:start/);
      assert.match(log, /node:start/);
      assert.match(log, /node:crash/);
      assert.match(log, /nginx:quit/);
      assert.match(result.stderr, /Node\.js application exited unexpectedly with code 37/);
      assert.match(result.stdout, /Container supervision finished with exit code 37/);
    } finally {
      await harness.cleanup();
    }
  });

  it('exits non-zero and tears down Node.js when the NGINX master crashes', async () => {
    const harness = await createHarness({
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

  it('shuts both supervised processes down cleanly on SIGTERM', async () => {
    const harness = await createHarness();

    try {
      await waitForLogEntries(harness.logPath, ['nginx:start', 'node:start'], 10000);
      harness.child.kill('SIGTERM');

      const result = await waitForResult(harness.resultPromise, 10000);
      const log = await readLog(harness.logPath);

      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.match(log, /node:term/);
      assert.match(log, /nginx:quit/);
      assert.match(result.stdout, /Received SIGTERM/);
      assert.match(result.stdout, /Container supervision finished with exit code 0/);
    } finally {
      await harness.cleanup();
    }
  });

  it('keeps the manifests on restart-friendly policies with no wedged failure mode', async () => {
    const entrypoint = await fs.readFile(path.join(repoRoot, 'docker-entrypoint.sh'), 'utf8');
    const compose = await fs.readFile(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    const swarm = await fs.readFile(path.join(repoRoot, 'docker-compose.swarm.yml'), 'utf8');

    assert.doesNotMatch(entrypoint, /sleep infinity/);
    assert.doesNotMatch(entrypoint, /restart\.state/);
    assert.match(entrypoint, /wait -n -p exited_pid/);

    assert.match(compose, /restart:\s+unless-stopped/);
    assert.match(compose, /stop_grace_period:\s+45s/);
    assert.doesNotMatch(compose, /network_mode:\s+host/);

    assert.match(swarm, /condition:\s+any/);
    assert.match(swarm, /stop_grace_period:\s+45s/);
    assert.doesNotMatch(swarm, /max_attempts:/);
  });
});

