import { AuthIdentity } from '../types/auth-identity';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  originalUrl?: string;
  ip?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  route?: {
    path?: string;
  };
  socket?: {
    remoteAddress?: string;
  };
  connection?: {
    remoteAddress?: string;
  };
  auth?: AuthIdentity;
  user?: AuthIdentity;
  auditContext?: {
    correlationId: string;
    startedAt: string;
  };
}
