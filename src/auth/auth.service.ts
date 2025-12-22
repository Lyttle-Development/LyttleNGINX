import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  // In production, these should come from a database
  private readonly validApiKeys: Set<string>;
  private readonly adminUsername: string;
  private readonly adminPasswordHash: string;

  constructor(private jwtService: JwtService) {
    // Load API keys from environment (comma-separated)
    const apiKeys = process.env.API_KEY?.split(',').filter(Boolean) || [];
    this.validApiKeys = new Set(apiKeys);

    // Load admin credentials from environment
    this.adminUsername = process.env.ADMIN_USERNAME || 'admin';
    this.adminPasswordHash =
      process.env.ADMIN_PASSWORD_HASH ||
      this.hashPassword(
        process.env.ADMIN_PASSWORD || 'change-me-in-production',
      );
  }

  /**
   * Validate API key
   */
  validateApiKey(apiKey: string): boolean {
    // If no API keys configured, allow access (development mode)
    if (
      this.validApiKeys.size === 0 &&
      process.env.NODE_ENV === 'development'
    ) {
      return true;
    }

    return this.validApiKeys.has(apiKey);
  }

  /**
   * Validate username and password
   */
  async validateUser(username: string, password: string): Promise<any> {
    const passwordHash = this.hashPassword(password);

    if (
      username === this.adminUsername &&
      passwordHash === this.adminPasswordHash
    ) {
      return { username, role: 'admin' };
    }

    return null;
  }

  /**
   * Generate JWT token
   */
  async login(user: any) {
    const payload = { username: user.username, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      expires_in: process.env.JWT_EXPIRATION || '24h',
      token_type: 'Bearer',
    };
  }

  /**
   * Hash password using SHA256
   */
  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return !!(
      process.env.JWT_SECRET ||
      this.validApiKeys.size > 0 ||
      process.env.ADMIN_PASSWORD
    );
  }
}
