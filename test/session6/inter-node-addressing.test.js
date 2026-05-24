const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const {
  buildClusterNodeUrl,
  getClusterNodeControlPlaneEndpoint,
  getLocalControlPlaneRegistration,
} = require('../../src/utils/network-utils');

describe('Session 6 control-plane endpoint resolution', () => {
  it('builds the local advertised endpoint from explicit address/port configuration', () => {
    const registration = getLocalControlPlaneRegistration({
      NODE_ENV: 'production',
      CLUSTER_CONTROL_ADDRESS: 'node-a.internal',
      CLUSTER_CONTROL_PORT: '3003',
      CLUSTER_CONTROL_PROTOCOL: 'https',
    });

    assert.deepEqual(registration.issues, []);
    assert.deepEqual(registration.endpoint, {
      address: 'node-a.internal',
      port: 3003,
      protocol: 'https',
      baseUrl: 'https://node-a.internal:3003',
      source: 'CLUSTER_CONTROL_ADDRESS',
    });
  });

  it('accepts a full explicit control-plane URL when it includes a port', () => {
    const registration = getLocalControlPlaneRegistration({
      NODE_ENV: 'production',
      CLUSTER_CONTROL_URL: 'http://node-b.internal:3100',
    });

    assert.deepEqual(registration.issues, []);
    assert.equal(registration.endpoint?.baseUrl, 'http://node-b.internal:3100');
    assert.equal(registration.endpoint?.address, 'node-b.internal');
    assert.equal(registration.endpoint?.port, 3100);
    assert.equal(registration.endpoint?.protocol, 'http');
  });

  it('rejects loopback control-plane addresses in production', () => {
    const registration = getLocalControlPlaneRegistration({
      NODE_ENV: 'production',
      CLUSTER_CONTROL_ADDRESS: '127.0.0.1',
      CLUSTER_CONTROL_PORT: '3003',
    });

    assert.equal(registration.endpoint, null);
    assert.match(registration.issues.join('\n'), /not routable from peer nodes/i);
  });

  it('builds peer request URLs from registered node metadata instead of implicit ports', () => {
    const node = {
      ipAddress: 'stale-address-that-should-not-be-used',
      metadata: {
        controlPlane: {
          address: 'node-c.internal',
          port: 3200,
          protocol: 'http',
          baseUrl: 'http://node-c.internal:3200',
        },
      },
    };

    const endpoint = getClusterNodeControlPlaneEndpoint(node);
    const url = buildClusterNodeUrl(node, '/cluster/reload', {
      broadcast: 'false',
    });

    assert.deepEqual(endpoint, {
      address: 'node-c.internal',
      port: 3200,
      protocol: 'http',
      baseUrl: 'http://node-c.internal:3200',
      source: 'cluster-node.metadata.controlPlane.baseUrl',
    });
    assert.equal(url, 'http://node-c.internal:3200/cluster/reload?broadcast=false');
  });

  it('rejects registered peer endpoints that are still loopback-only', () => {
    const url = buildClusterNodeUrl(
      {
        metadata: {
          controlPlane: {
            baseUrl: 'http://localhost:3003',
          },
        },
      },
      '/certificates/sync',
    );

    assert.equal(url, null);
  });
});

describe('Session 6 source and manifest regressions', () => {
  it('removes public-IP discovery and direct PORT-based peer URL assumptions from the codebase', async () => {
    const networkUtils = await fs.readFile(
      path.join(repoRoot, 'src/utils/network-utils.ts'),
      'utf8',
    );
    const clusterOperationsService = await fs.readFile(
      path.join(repoRoot, 'src/distributed-lock/cluster-operations.service.ts'),
      'utf8',
    );
    const certificateService = await fs.readFile(
      path.join(repoRoot, 'src/certificate/certificate.service.ts'),
      'utf8',
    );

    assert.doesNotMatch(networkUtils, /ipify|icanhazip|ifconfig\.me/i);
    assert.match(clusterOperationsService, /buildClusterNodeUrl/);
    assert.doesNotMatch(clusterOperationsService, /process\.env\.PORT\s*\|\|\s*3000/);
    assert.doesNotMatch(certificateService, /process\.env\.PORT\s*\|\|\s*3000/);
    assert.doesNotMatch(clusterOperationsService, /http:\/\/\$\{node\.ipAddress\}/);
    assert.doesNotMatch(certificateService, /http:\/\/\$\{node\.ipAddress\}/);
  });

  it('keeps deployment configuration explicit about advertised control-plane address and peer-facing port', async () => {
    const envExample = await fs.readFile(path.join(repoRoot, '.env.example'), 'utf8');
    const compose = await fs.readFile(
      path.join(repoRoot, 'docker-compose.yml'),
      'utf8',
    );
    const swarm = await fs.readFile(
      path.join(repoRoot, 'docker-compose.swarm.yml'),
      'utf8',
    );
    const readme = await fs.readFile(path.join(repoRoot, 'README.md'), 'utf8');

    assert.match(envExample, /CLUSTER_CONTROL_ADDRESS/);
    assert.match(envExample, /CLUSTER_CONTROL_PORT/);
    assert.match(envExample, /CLUSTER_CONTROL_URL/);

    assert.match(compose, /CLUSTER_CONTROL_ADDRESS:\s*\$\{CLUSTER_CONTROL_ADDRESS:-app\}/);
    assert.match(compose, /CLUSTER_CONTROL_PORT:\s*\$\{CLUSTER_CONTROL_PORT:-3000\}/);

    assert.match(swarm, /CLUSTER_CONTROL_ADDRESS=\{\{\.Node\.Hostname\}\}/);
    assert.match(swarm, /CLUSTER_CONTROL_PORT=\$\{CLUSTER_CONTROL_PORT:-3003\}/);
    assert.match(swarm, /PORT=\$\{PORT:-3000\}/);
    assert.match(swarm, /published:\s*3003/);

    assert.match(readme, /CLUSTER_CONTROL_ADDRESS/);
    assert.match(readme, /CLUSTER_CONTROL_PORT/);
    assert.match(readme, /do not assume it matches PORT/i);
  });
});

