import { AuthIdentity } from '../../auth/types/auth-identity';
import { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditTargetDescriptor {
  type?: string;
  id?: string;
  label?: string;
}

export type AuditTargetValue = string | AuditTargetDescriptor | undefined;

export type AuditTargetResolver = (
  request: AuthenticatedRequest,
  responseBody?: unknown,
) => AuditTargetValue;

export interface AuditOptions {
  action?: string;
  target?: AuditTargetValue | AuditTargetResolver;
}

export interface AuditWriteInput {
  action: string;
  outcome: AuditOutcome;
  responseStatus: number;
  correlationId: string;
  requestMethod: string;
  requestPath: string;
  target?: AuditTargetValue;
  actor?: AuthIdentity;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditQueryOptions {
  limit: number;
  action?: string;
  actorSubject?: string;
  correlationId?: string;
  outcome?: AuditOutcome;
}
