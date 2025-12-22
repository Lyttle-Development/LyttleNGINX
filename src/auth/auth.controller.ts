import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiKeyGuard } from './guards/api-key.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('status')
  @UseGuards(ApiKeyGuard)
  async getStatus() {
    return {
      authenticated: true,
      message: 'API key authentication is working',
    };
  }

  @Get('info')
  async getAuthInfo() {
    return {
      authEnabled: this.authService.isAuthEnabled(),
      methods: ['api-key'],
      apiKeyConfigured: !!process.env.API_KEY,
    };
  }
}
