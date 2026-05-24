import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentIdentity } from './decorators/current-identity.decorator';
import { AuthIdentity } from './types/auth-identity';

@Controller('auth')
export class AuthController {
  private readonly authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  @Get('status')
  @UseGuards(ApiKeyGuard)
  async getStatus(@CurrentIdentity() identity: AuthIdentity) {
    return {
      authenticated: true,
      message: `${identity.authMethod} authentication is working`,
      identity: this.presentIdentity(identity),
    };
  }

  @Get('info')
  async getAuthInfo() {
    return this.authService.getAuthCapabilities();
  }

  @Get('me')
  async getCurrentIdentity(@CurrentIdentity() identity: AuthIdentity) {
    return {
      authenticated: true,
      identity: this.presentIdentity(identity),
    };
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  async exchangeLegacyApiKey(@CurrentIdentity() identity: AuthIdentity) {
    if (identity.authMethod !== 'api-key') {
      throw new BadRequestException(
        'Token exchange is only available for legacy API-key authenticated requests',
      );
    }

    return this.authService.issueAccessToken(identity);
  }

  private presentIdentity(identity: AuthIdentity) {
    return {
      id: identity.id,
      subject: identity.subject,
      actorType: identity.actorType,
      authMethod: identity.authMethod,
      displayName: identity.displayName,
      roles: identity.roles,
      scopes: identity.scopes,
      audience: identity.audience,
      issuer: identity.issuer,
      apiKeyId: identity.apiKeyId,
      nodeId: identity.nodeId,
      tokenId: identity.tokenId,
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
    };
  }
}
