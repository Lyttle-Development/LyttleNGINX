import { AuthIdentity } from '../types/auth-identity';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthIdentity;
  user?: AuthIdentity;
}
