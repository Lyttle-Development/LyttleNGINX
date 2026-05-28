require('reflect-metadata');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { LogsService } = require('../../src/logs/logs.service');

class TestResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  finish(statusCode = 200) {
    this.statusCode = statusCode;
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
  }
}

function createActor(role = 'operator', subject = `${role}-user`) {
  return {
    id: `${subject}-id`,
    subject,
    actorType: 'admin',
    authMethod: 'bearer-token',
    displayName: subject,
    roles: [role],
    scopes: ['admin:full'],
    audience: ['lyttle-nginx-admin'],
  };
}

function readLastJsonLogLine(writes) {
  const line = [...writes]
    .reverse()
    .find((entry) => entry.trim().startsWith('{') && entry.trim().endsWith('}'));
  assert.ok(line, 'expected at least one JSON log line');
  return JSON.parse(line);
}

describe('Session 24 structured operational logging', () => {
  it('emits structured JSON logs with request, actor, operation, and redacted secret fields', async () => {
    const logsService = new LogsService();
    const request = {
      method: 'POST',
      originalUrl: '/cluster/reload?broadcast=true',
      url: '/cluster/reload?broadcast=true',
      headers: {
        'x-correlation-id': 'corr-123',
        authorization: 'Bearer super-secret-token',
        'x-forwarded-for': '10.20.30.40',
      },
      query: {
        operationId: 'operation-123',
      },
      auditContext: {
        correlationId: 'corr-123',
        startedAt: '2026-05-28T00:00:00.000Z',
      },
      auth: createActor('platform-admin', 'platform-admin-user'),
    };

    logsService.runWithContext(
      {
        request,
        correlationId: 'corr-123',
        operationId: 'operation-123',
      },
      () => {
        logsService.log(
          {
            message: 'Queued cluster reload',
            event: 'cluster.reload.queued',
            apiKey: 'very-secret-api-key',
            nested: {
              authorization: 'Bearer nested-secret-token',
              keyPem:
                '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
            },
          },
          'ClusterController',
        );
      },
    );

    const entry = logsService.getLastLogs(1)[0];
    assert.equal(entry.stream, 'operational');
    assert.equal(entry.level, 'log');
    assert.equal(entry.message, 'Queued cluster reload');
    assert.equal(entry.event, 'cluster.reload.queued');
    assert.equal(entry.source, 'ClusterController');
    assert.equal(entry.correlationId, 'corr-123');
    assert.equal(entry.requestId, 'corr-123');
    assert.equal(entry.operationId, 'operation-123');
    assert.equal(entry.request.method, 'POST');
    assert.equal(entry.request.path, '/cluster/reload?broadcast=true');
    assert.equal(entry.request.ipAddress, '10.20.30.40');
    assert.equal(entry.actor.subject, 'platform-admin-user');
    assert.deepEqual(entry.actor.roles, ['platform-admin']);
    assert.equal(entry.data.apiKey, '[REDACTED]');
    assert.equal(entry.data.nested.authorization, '[REDACTED]');
    assert.equal(entry.data.nested.keyPem, '[REDACTED]');
    assert.equal(readLastJsonLogLine(logsService.getLastLogLines(1)).event, 'cluster.reload.queued');
  });

  it('binds request context for lifecycle logging and mirrors the correlation id header', async () => {
    const logsService = new LogsService();
    const request = {
      method: 'GET',
      originalUrl: '/logs?count=1',
      url: '/logs?count=1',
      headers: {
        'x-request-id': 'req-789',
        'x-forwarded-for': '192.0.2.15',
      },
      query: {
        count: '1',
      },
    };
    const response = new TestResponse();

    await new Promise((resolve) => {
      logsService.bindRequestContext(request, response, () => {
        request.auth = createActor('viewer', 'viewer-user');
        setImmediate(() => {
          response.finish(202);
          resolve();
        });
      });
    });

    assert.equal(response.headers['X-Correlation-Id'], 'req-789');

    const entry = logsService.getLastLogs(1)[0];
    assert.equal(entry.event, 'http.request.completed');
    assert.equal(entry.message, 'HTTP request completed');
    assert.equal(entry.correlationId, 'req-789');
    assert.equal(entry.requestId, 'req-789');
    assert.equal(entry.request.method, 'GET');
    assert.equal(entry.request.path, '/logs?count=1');
    assert.equal(entry.request.statusCode, 202);
    assert.equal(entry.request.ipAddress, '192.0.2.15');
    assert.equal(entry.actor.subject, 'viewer-user');
    assert.equal(typeof entry.request.durationMs, 'number');
    assert.ok(entry.request.durationMs >= 0);
    assert.equal(readLastJsonLogLine(logsService.getLastLogLines(5)).event, 'http.request.completed');
  });
});
