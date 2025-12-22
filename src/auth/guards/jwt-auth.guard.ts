import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Skip authentication in development if JWT_SECRET is not set
    if (
      process.env.NODE_ENV === 'development' &&
      !process.env.JWT_SECRET &&
      !process.env.API_KEY
    ) {
      return true;
    }

    return super.canActivate(context);
  }
}
