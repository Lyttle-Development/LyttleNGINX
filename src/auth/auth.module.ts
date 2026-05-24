import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AuthorizationGuard } from './guards/authorization.guard';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthorizationGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
