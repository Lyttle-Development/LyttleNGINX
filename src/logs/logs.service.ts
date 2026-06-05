import { Injectable, LoggerService } from '@nestjs/common';
import { ensureAuditContext, getRequestIpAddress, getRequestPath } from '../audit/audit-context';
import { AuthIdentity } from '../auth/types/auth-identity';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { getLogContext, runWithLogContext } from './log-context';

const MAX_LOG_ENTRIES = Number.parseInt(
  process.env['LOG_BUFFER_SIZE'] ?? '1000',
  10,
);
const REDACTED_VALUE = '[REDACTED]';

type OperationalLogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

export interface StructuredOperationalLogEntry {
  timestamp: string;
  stream: 'operational';
  level: OperationalLogLevel;
  message: string;
  source?: string;
  event?: string;
  nodeId: string;
  pid: number;
  correlationId?: string;
  requestId?: string;
  operationId?: string;
  actor?: {
    id: string;
    subject: string;
    actorType: string;
    displayName: string;
    authMethod: string;
    roles: string[];
    nodeId?: string;
  };
  request?: {
    method?: string;
    path?: string;
    ipAddress?: string;
    statusCode?: number;
    durationMs?: number;
  };
  data?: unknown;
  trace?: string;
}

type BufferedLogEntry = {
  entry: StructuredOperationalLogEntry;
  line: string;
};

@Injectable()
export class LogsService implements LoggerService {
  private readonly buffer: BufferedLogEntry[] = [];
  private readonly nodeId =
    process.env['CLUSTER_NODE_ID']?.trim() ||
    process.env['HOSTNAME']?.trim() ||
    'unknown-node';

  log(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.writeFromLoggerCall('fatal', message, optionalParams);
  }

  runWithContext<T>(
    context: Parameters<typeof runWithLogContext>[0],
    callback: () => T,
  ) {
    return runWithLogContext(context, callback);
  }

  bindRequestContext(
    request: AuthenticatedRequest,
    response: {
      statusCode?: number;
      once: (event: 'finish' | 'close', listener: () => void) => void;
      removeListener?: (event: 'finish' | 'close', listener: () => void) => void;
      setHeader?: (name: string, value: string) => void;
      writableEnded?: boolean;
    },
    next: () => void,
  ) {
    const auditContext = ensureAuditContext(request, response);
    const operationId = this.extractRequestOperationId(request);
    const startedAt = Date.now();

    return runWithLogContext(
      {
        request,
        correlationId: auditContext.correlationId,
        operationId,
      },
      () => {
        let settled = false;
        const finalize = (event: 'completed' | 'closed') => {
          if (settled) {
            return;
          }

          settled = true;
          response.removeListener?.('finish', onFinish);
          response.removeListener?.('close', onClose);

          this.recordRequestLifecycleEvent(
            event,
            request,
            response.statusCode ?? 200,
            Date.now() - startedAt,
            operationId,
          );
        };
        const onFinish = () => finalize('completed');
        const onClose = () => {
          if (!response.writableEnded) {
            finalize('closed');
          }
        };

        response.once('finish', onFinish);
        response.once('close', onClose);

        next();
      },
    );
  }

  getLastLogs(count: number): StructuredOperationalLogEntry[] {
    return this.buffer.slice(-count).map(({ entry }) => ({ ...entry }));
  }

  getLastLogLines(count: number): string[] {
    return this.buffer.slice(-count).map(({ line }) => line);
  }

  private writeFromLoggerCall(
    level: OperationalLogLevel,
    message: unknown,
    optionalParams: unknown[],
  ) {
    const payload = this.normalizeLoggerCall(level, message, optionalParams);
    this.writeEntry(
      this.createEntry(level, payload.message, {
        source: payload.source,
        event: payload.event,
        data: payload.data,
        trace: payload.trace,
      }),
    );
  }

  private recordRequestLifecycleEvent(
    lifecycle: 'completed' | 'closed',
    request: AuthenticatedRequest,
    statusCode: number,
    durationMs: number,
    operationId?: string,
  ) {
    this.writeEntry(
      this.createEntry('log', `HTTP request ${lifecycle}`, {
        source: 'http.request',
        event: `http.request.${lifecycle}`,
        request,
        operationId,
        statusCode,
        durationMs,
      }),
    );
  }

  private createEntry(
    level: OperationalLogLevel,
    message: string,
    options: {
      source?: string;
      event?: string;
      data?: unknown;
      trace?: string;
      request?: AuthenticatedRequest;
      operationId?: string;
      statusCode?: number;
      durationMs?: number;
    } = {},
  ): StructuredOperationalLogEntry {
    const context = getLogContext();
    const request = options.request ?? context?.request;
    const correlationId =
      request?.auditContext?.correlationId ?? context?.correlationId;
    const operationId =
      options.operationId ?? context?.operationId ?? this.extractRequestOperationId(request);

    return {
      timestamp: new Date().toISOString(),
      stream: 'operational',
      level,
      message,
      ...(options.source ? { source: options.source } : {}),
      ...(options.event ? { event: options.event } : {}),
      nodeId: this.nodeId,
      pid: process.pid,
      ...(correlationId
        ? {
            correlationId,
            requestId: correlationId,
          }
        : {}),
      ...(operationId ? { operationId } : {}),
      ...(request
        ? {
            actor: this.serializeActor(request.auth),
            request: {
              method: request.method,
              path: getRequestPath(request),
              ipAddress: getRequestIpAddress(request),
              ...(options.statusCode !== undefined
                ? { statusCode: options.statusCode }
                : {}),
              ...(options.durationMs !== undefined
                ? { durationMs: options.durationMs }
                : {}),
            },
          }
        : {}),
      ...(options.data !== undefined
        ? { data: this.redactValue(options.data) }
        : {}),
      ...(options.trace ? { trace: this.redactTrace(options.trace) } : {}),
    };
  }

  private writeEntry(entry: StructuredOperationalLogEntry) {
    const line = JSON.stringify(entry);
    this.buffer.push({ entry, line });
    if (this.buffer.length > MAX_LOG_ENTRIES) {
      this.buffer.shift();
    }

    const target = entry.level === 'error' || entry.level === 'fatal'
      ? process.stderr
      : process.stdout;
    target.write(line + '\n');
  }

  private normalizeLoggerCall(
    level: OperationalLogLevel,
    message: unknown,
    optionalParams: unknown[],
  ) {
    const params = [...optionalParams];
    let source: string | undefined;
    let trace: string | undefined;
    let event: string | undefined;

    const lastParam = params.length > 0 ? params[params.length - 1] : undefined;
    if (typeof lastParam === 'string' && !this.looksLikeTrace(lastParam)) {
      source = lastParam;
      params.pop();
    }

    if (level === 'error' || level === 'fatal') {
      const firstParam = params[0];
      if (typeof firstParam === 'string' && this.looksLikeTrace(firstParam)) {
        trace = firstParam;
        params.shift();
      }
    }

    let messageText: string;
    let data: unknown = params.length === 0 ? undefined : params.length === 1 ? params[0] : params;

    if (message instanceof Error) {
      messageText = message.message;
      trace ??= message.stack;
      data = {
        name: message.name,
        ...(data !== undefined ? { details: data } : {}),
      };
    } else if (typeof message === 'string') {
      messageText = message;
    } else if (typeof message === 'object' && message !== null) {
      const record = message as Record<string, unknown>;
      const structuredMessage =
        typeof record['message'] === 'string' ? record['message'] : undefined;
      const structuredEvent =
        typeof record['event'] === 'string' ? record['event'] : undefined;
      messageText = structuredMessage || structuredEvent || 'Structured log event';
      event = structuredEvent;
      data = data === undefined ? record : { message: record, details: data };
    } else {
      messageText = String(message);
    }

    return {
      message: messageText,
      source,
      event,
      data,
      trace,
    };
  }

  private serializeActor(actor: AuthIdentity | undefined) {
    if (!actor) {
      return undefined;
    }

    return {
      id: actor.id,
      subject: actor.subject,
      actorType: actor.actorType,
      displayName: actor.displayName,
      authMethod: actor.authMethod,
      roles: [...actor.roles],
      ...(actor.nodeId ? { nodeId: actor.nodeId } : {}),
    };
  }

  private redactValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
    if (this.isSensitiveKey(key) || this.isSensitiveString(value)) {
      return REDACTED_VALUE;
    }

    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'string') {
      return value.length > 4000 ? `${value.slice(0, 3997)}...` : value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
      return `<Buffer length=${value.length}>`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.redactValue(entry, key, seen));
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }

      seen.add(value);

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          ...(value.stack ? { stack: this.redactTrace(value.stack) } : {}),
        };
      }

      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          this.redactValue(entryValue, entryKey, seen),
        ]),
      );
    }

    return String(value);
  }

  private redactTrace(trace: string) {
    return this.isSensitiveString(trace) ? REDACTED_VALUE : trace;
  }

  private isSensitiveKey(key: string | undefined) {
    if (!key) {
      return false;
    }

    return /(^|[-_.])(authorization|api[-_]?key|token|secret|password|passphrase|cookie|private[-_]?key|keypem|client[-_]?secret|master[-_]?key|encryption[-_]?key)([-_.]|$)/i.test(
      key,
    );
  }

  private isSensitiveString(value: unknown) {
    if (typeof value !== 'string') {
      return false;
    }

    return (
      /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/.test(value) ||
      /^Bearer\s+.+/i.test(value) ||
      /^ApiKey\s+.+/i.test(value)
    );
  }

  private looksLikeTrace(value: string) {
    return value.includes('\n') || value.includes(' at ');
  }

  private extractRequestOperationId(request?: AuthenticatedRequest) {
    const candidate = request?.query?.['operationId'];
    return typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : undefined;
  }
}
