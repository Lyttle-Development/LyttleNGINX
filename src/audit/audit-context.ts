import { randomUUID } from 'crypto';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const first = value.find(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    );
    return first?.trim();
  }

  return undefined;
}

function sanitizeCorrelationId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    return undefined;
  }

  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined;
}

export function ensureAuditContext(
  request: AuthenticatedRequest,
  response?: { setHeader?: (name: string, value: string) => void },
) {
  const existing = request.auditContext;
  if (existing?.correlationId) {
    response?.setHeader?.('X-Correlation-Id', existing.correlationId);
    return existing;
  }

  const correlationId =
    sanitizeCorrelationId(
      firstHeaderValue(request.headers?.['x-correlation-id']),
    ) ||
    sanitizeCorrelationId(
      firstHeaderValue(request.headers?.['x-request-id']),
    ) ||
    randomUUID();

  request.auditContext = {
    correlationId,
    startedAt: new Date().toISOString(),
  };

  response?.setHeader?.('X-Correlation-Id', correlationId);

  return request.auditContext;
}

export function getRequestPath(request: AuthenticatedRequest) {
  return request.originalUrl || request.url || request.route?.path || '/';
}

export function getRequestIpAddress(request: AuthenticatedRequest) {
  const forwardedFor = firstHeaderValue(request.headers?.['x-forwarded-for']);
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim();
  }

  return (
    request.ip ||
    request.socket?.remoteAddress ||
    request.connection?.remoteAddress
  );
}
