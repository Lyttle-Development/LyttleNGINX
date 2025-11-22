import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

class LoginDto {
  username: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus() {
    return {
      authenticated: true,
      message: 'JWT authentication is working',
    };
  }

  @Get('info')
  async getAuthInfo() {
    return {
      authEnabled: this.authService.isAuthEnabled(),
      methods: ['jwt', 'api-key'],
      jwtConfigured: !!process.env.JWT_SECRET,
      apiKeyConfigured: !!process.env.API_KEYS,
    };
  }
}
