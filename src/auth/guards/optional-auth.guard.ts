import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT guard - doesn't throw if no token provided
 * Useful for endpoints that work with or without authentication
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // If authentication fails, just return null (no user)
    // Don't throw an error
    if (err || !user) {
      return null;
    }
    return user;
  }

  canActivate(context: ExecutionContext) {
    // Always skip in development without JWT_SECRET
    if (process.env.NODE_ENV === 'development' && !process.env.JWT_SECRET) {
      return true;
    }

    return super.canActivate(context);
  }
}
