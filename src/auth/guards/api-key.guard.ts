import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request.headers);

    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }

    if (!this.authService.validateApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
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
