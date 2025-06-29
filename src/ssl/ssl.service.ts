import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

@Injectable()
export class SslService {
  private readonly logger = new Logger(SslService.name);
  private readonly sslDir = '/etc/nginx/ssl';
  private readonly certFile = join(this.sslDir, 'server.crt');
  private readonly keyFile = join(this.sslDir, 'server.key');
  private renewalTimer: NodeJS.Timeout | null = null;

  /**
   * Ensure SSL certificates exist and are valid
   */
  async ensureSslCertificates(): Promise<void> {
    this.logger.log('Ensuring SSL certificates exist and are valid...');
    
    // Create SSL directory if it doesn't exist
    await mkdir(this.sslDir, { recursive: true });

    // Check if certificates exist and are valid
    if (!this.certificatesExist() || await this.isCertExpired()) {
      this.logger.log('Generating new self-signed SSL certificate...');
      await this.generateSelfSignedCert();
    } else {
      this.logger.log('SSL certificates are valid and up to date');
    }
  }

  /**
   * Generate a self-signed SSL certificate
   */
  async generateSelfSignedCert(): Promise<void> {
    try {
      const cmd = [
        'openssl req -x509 -nodes -days 365',
        `-keyout ${this.keyFile}`,
        `-out ${this.certFile}`,
        '-subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"'
      ].join(' ');

      this.logger.log(`Executing: ${cmd}`);
      await execAsync(cmd);
      this.logger.log('Self-signed SSL certificate generated successfully');
    } catch (error) {
      this.logger.error('Failed to generate SSL certificate:', error);
      throw error;
    }
  }

  /**
   * Check if certificate files exist
   */
  private certificatesExist(): boolean {
    return existsSync(this.certFile) && existsSync(this.keyFile);
  }

  /**
   * Check if the certificate is expired or will expire soon (within 7 days)
   */
  async isCertExpired(): Promise<boolean> {
    if (!this.certificatesExist()) {
      return true;
    }

    try {
      const cmd = `openssl x509 -in ${this.certFile} -checkend 604800`; // 7 days in seconds
      await execAsync(cmd);
      return false; // Certificate is valid
    } catch (error) {
      this.logger.warn('Certificate is expired or will expire soon');
      return true; // Certificate is expired or will expire soon
    }
  }

  /**
   * Start the automatic renewal timer
   */
  startRenewalTimer(): void {
    const intervalDays = parseInt(process.env.SSL_RENEWAL_INTERVAL_DAYS || '25', 10);
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds

    this.logger.log(`Starting SSL certificate renewal timer (every ${intervalDays} days)`);

    this.renewalTimer = setInterval(async () => {
      this.logger.log('SSL certificate renewal timer triggered');
      try {
        await this.ensureSslCertificates();
        // Reload NGINX after certificate renewal
        await this.reloadNginx();
      } catch (error) {
        this.logger.error('Failed to renew SSL certificate:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop the renewal timer
   */
  stopRenewalTimer(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
      this.logger.log('SSL certificate renewal timer stopped');
    }
  }

  /**
   * Reload NGINX configuration
   */
  private async reloadNginx(): Promise<void> {
    try {
      this.logger.log('Reloading NGINX after SSL certificate renewal...');
      await execAsync('nginx -s reload');
      this.logger.log('NGINX reloaded successfully');
    } catch (error) {
      this.logger.error('Failed to reload NGINX:', error);
      throw error;
    }
  }

  /**
   * Get SSL certificate file paths
   */
  getCertificatePaths(): { certFile: string; keyFile: string } {
    return {
      certFile: this.certFile,
      keyFile: this.keyFile,
    };
  }
}