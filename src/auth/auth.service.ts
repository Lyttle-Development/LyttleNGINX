import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AuthService {
  // In production, these should come from a database
  private readonly validApiKeys: Set<string>;

  constructor() {
    // Load API keys from environment (comma-separated)
    const apiKeys =
      process.env.API_KEY?.split(',')
        .map((apiKey) => apiKey.trim())
        .filter(Boolean) || [];
    this.validApiKeys = new Set(apiKeys);
  }

  /**
   * Validate API key
   */
  validateApiKey(apiKey: string): boolean {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey || this.validApiKeys.size === 0) {
      return false;
    }

    const provided = Buffer.from(normalizedApiKey);

    for (const validApiKey of this.validApiKeys) {
      const candidate = Buffer.from(validApiKey);
      if (
        provided.length === candidate.length &&
        timingSafeEqual(provided, candidate)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return this.validApiKeys.size > 0;
  }
}
