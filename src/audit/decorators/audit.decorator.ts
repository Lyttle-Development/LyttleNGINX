import { SetMetadata } from '@nestjs/common';
import { AuditOptions } from '../types/audit.types';

export const AUDIT_OPTIONS_KEY = 'audit:options';

export const Audit = (options: AuditOptions = {}) =>
  SetMetadata(AUDIT_OPTIONS_KEY, options);

export function shouldAuditHttpRequest(
  method: string | undefined,
  options?: AuditOptions,
) {
  if (options) {
    return true;
  }

  const normalizedMethod = method?.toUpperCase();
  return (
    normalizedMethod === 'POST' ||
    normalizedMethod === 'PUT' ||
    normalizedMethod === 'PATCH' ||
    normalizedMethod === 'DELETE'
  );
}
