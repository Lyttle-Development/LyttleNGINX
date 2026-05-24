import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly authService: AuthService;
  private readonly reflector: Reflector;

  constructor(authService: AuthService, reflector: Reflector) {
    this.authService = authService;
    this.reflector = reflector;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const bearerToken = this.extractBearerToken(request.headers);

    if (bearerToken) {
      const identity = this.authService.authenticateBearerToken(bearerToken);
      request.auth = identity;
      request.user = identity;
      return true;
    }

    const apiKey = this.extractApiKey(request.headers);
    if (!apiKey) {
      throw new UnauthorizedException('Authentication credentials are required');
    }

    const identity = this.authService.authenticateApiKey(apiKey);
    if (!identity) {
      throw new UnauthorizedException('Invalid API key');
    }

    request.auth = identity;
    request.user = identity;

    return true;
  }

  private extractBearerToken(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const authorization = headers['authorization'];
    if (typeof authorization !== 'string') {
      return undefined;
    }

    const [scheme, ...credentials] = authorization.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || credentials.length === 0) {
      return undefined;
    }

    const token = credentials.join(' ').trim();
    return token || undefined;
  }

  private extractApiKey(headers: Record<string, string | string[] | undefined>) {
    const headerApiKey = headers['x-api-key'];
    if (typeof headerApiKey === 'string' && headerApiKey.trim()) {
      return headerApiKey.trim();
    }

    const authorization = headers['authorization'];
    if (typeof authorization !== 'string') {
      return undefined;
    }

    const [scheme, ...credentials] = authorization.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'apikey' || credentials.length === 0) {
      return undefined;
    }

    const apiKey = credentials.join(' ').trim();
    return apiKey || undefined;
  }
}
