import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  // In production, these should come from a database
  private readonly validApiKeys: Set<string>;

  constructor() {
    // Load API keys from environment (comma-separated)
    const apiKeys = process.env.API_KEY?.split(',').filter(Boolean) || [];
    this.validApiKeys = new Set(apiKeys);
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
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return this.validApiKeys.size > 0;
  }
}
