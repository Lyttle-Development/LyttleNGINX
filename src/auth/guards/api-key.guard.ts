import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip authentication in development if no API keys configured
    if (process.env.NODE_ENV === 'development' && !process.env.API_KEY) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey =
      request.headers['x-api-key'] ||
      request.headers['authorization']?.replace('ApiKey ', '');

    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }

    if (!this.authService.validateApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
