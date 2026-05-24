import { HttpException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { getRequestPath } from './audit-context';
import {
  AuditOptions,
  AuditTargetDescriptor,
  AuditTargetValue,
} from './types/audit.types';

function readNestedString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
}

export function resolveAuditAction(
  request: AuthenticatedRequest,
  options?: AuditOptions,
) {
  return (
    options?.action?.trim() ||
    `${request.method?.toUpperCase() || 'REQUEST'} ${getRequestPath(request)}`
  );
}

export function resolveAuditTarget(
  request: AuthenticatedRequest,
  options?: AuditOptions,
  responseBody?: unknown,
): AuditTargetValue {
  const configuredTarget = options?.target;

  if (typeof configuredTarget === 'function') {
    return configuredTarget(request, responseBody);
  }

  if (configuredTarget !== undefined) {
    return configuredTarget;
  }

  return inferAuditTarget(request, responseBody);
}

export function resolveAuditOutcome(statusCode: number) {
  if (statusCode === 401 || statusCode === 403) {
    return 'denied' as const;
  }

  return statusCode >= 400 ? ('failure' as const) : ('success' as const);
}

export function resolveAuditError(error: unknown): {
  errorCode?: string;
  errorMessage?: string;
} {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return { errorMessage: response };
    }

    if (typeof response === 'object' && response !== null) {
      const message = response['message'];
      return {
        errorCode: readNestedString(
          response as Record<string, unknown>,
          'code',
        ),
        errorMessage: Array.isArray(message)
          ? message
              .filter((item): item is string => typeof item === 'string')
              .join('; ')
          : typeof message === 'string'
            ? message
            : error.message,
      };
    }

    return { errorMessage: error.message };
  }

  if (error instanceof Error) {
    return { errorMessage: error.message };
  }

  if (typeof error === 'string' && error.trim()) {
    return { errorMessage: error.trim() };
  }

  return {};
}

export function resolveAuditStatusCode(
  error: unknown,
  fallbackStatusCode?: number,
) {
  if (error instanceof HttpException) {
    return error.getStatus();
  }

  if (fallbackStatusCode && fallbackStatusCode >= 400) {
    return fallbackStatusCode;
  }

  return 500;
}

function inferAuditTarget(
  request: AuthenticatedRequest,
  responseBody?: unknown,
): AuditTargetValue {
  const params = request.params || {};
  const body = request.body || {};
  const responseRecord =
    typeof responseBody === 'object' && responseBody !== null
      ? (responseBody as Record<string, unknown>)
      : undefined;

  if (typeof params['id'] === 'string' && params['id'].trim()) {
    return { id: params['id'].trim() };
  }

  if (typeof params['filename'] === 'string' && params['filename'].trim()) {
    return {
      type: 'backup',
      id: params['filename'].trim(),
      label: params['filename'].trim(),
    };
  }

  if (typeof params['domain'] === 'string' && params['domain'].trim()) {
    return {
      type: 'domain',
      id: params['domain'].trim(),
      label: params['domain'].trim(),
    };
  }

  if (
    typeof responseRecord?.['id'] === 'string' &&
    responseRecord['id'].trim()
  ) {
    return { id: responseRecord['id'].trim() };
  }

  if (typeof body['id'] === 'string' && body['id'].trim()) {
    return { id: body['id'].trim() };
  }

  if (Array.isArray(body['domains']) && body['domains'].length > 0) {
    const domains = body['domains']
      .filter(
        (domain): domain is string =>
          typeof domain === 'string' && domain.trim().length > 0,
      )
      .map((domain) => domain.trim());

    if (domains.length > 0) {
      return {
        type: 'certificate',
        label: domains.join(','),
      } satisfies AuditTargetDescriptor;
    }
  }

  return undefined;
}
