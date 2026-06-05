import { ActorType } from './auth-identity';
import { AuthRole } from './auth-role';

export interface AuthorizationRule {
  actorTypes?: ActorType[];
  roles?: AuthRole[];
}

