import { Injectable, Logger } from '@nestjs/common';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const exec = promisify(execCb);

@Injectable()
export class TlsConfigService {
  private readonly logger = new Logger(TlsConfigService.name);
  private readonly dhParamPath = '/etc/nginx/ssl/dhparam.pem';
  private readonly sslDir = '/etc/nginx/ssl';

  /**
   * Generate Diffie-Hellman parameters for enhanced security
   * This can take a long time (minutes), so it's optional
   */
  async generateDhParams(bits: number = 2048): Promise<void> {
    this.logger.log(
      `[DH] Generating Diffie-Hellman parameters (${bits} bits)...`,
    );
    this.logger.warn(
      '[DH] This may take several minutes. Consider doing this offline and copying the file.',
    );

    // Ensure directory exists
    if (!fs.existsSync(this.sslDir)) {
      fs.mkdirSync(this.sslDir, { recursive: true });
    }

    // Check if already exists
    if (fs.existsSync(this.dhParamPath)) {
      this.logger.log('[DH] DH parameters already exist, skipping generation');
      return;
    }

    try {
      await exec(`openssl dhparam -out ${this.dhParamPath} ${bits}`);
      this.logger.log(`[DH] Successfully generated DH parameters`);
    } catch (err) {
      this.logger.error(
        '[DH] Failed to generate DH parameters',
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  /**
   * Check if DH parameters exist
   */
  dhParamsExist(): boolean {
    return fs.existsSync(this.dhParamPath);
  }

  /**
   * Get SSL/TLS configuration recommendations based on domain
   */
  getRecommendedTlsConfig(domain: string): {
    protocols: string[];
    cipherSuites: string;
    hsts: boolean;
    ocspStapling: boolean;
  } {
    // You could customize this based on domain or requirements
    return {
      protocols: ['TLSv1.2', 'TLSv1.3'],
      cipherSuites:
        'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
      hsts: true,
      ocspStapling: true,
    };
  }

  /**
   * Test SSL/TLS configuration for a domain
   */
  async testTlsConnection(
    domain: string,
    port: number = 443,
  ): Promise<{
    success: boolean;
    protocol?: string;
    cipher?: string;
    error?: string;
  }> {
    this.logger.log(`[TLS Test] Testing TLS connection to ${domain}:${port}`);

    try {
      const { stdout } = await exec(
        `echo | openssl s_client -connect ${domain}:${port} -servername ${domain} 2>/dev/null | grep -E '(Protocol|Cipher)'`,
      );

      const protocolMatch = stdout.match(/Protocol\s*:\s*(\S+)/);
      const cipherMatch = stdout.match(/Cipher\s*:\s*(\S+)/);

      return {
        success: true,
        protocol: protocolMatch?.[1],
        cipher: cipherMatch?.[1],
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get certificate information from a PEM string
   */
  async getCertificateInfo(certPem: string): Promise<{
    subject: string;
    issuer: string;
    validFrom: Date;
    validTo: Date;
    serialNumber: string;
    subjectAltNames?: string[];
  }> {
    const certFile = `/tmp/cert-info-${Date.now()}.pem`;
    try {
      fs.writeFileSync(certFile, certPem, 'utf8');

      const { stdout: textOutput } = await exec(
        `openssl x509 -in ${certFile} -text -noout`,
      );

      // Parse subject
      const subjectMatch = textOutput.match(/Subject: (.*)/);
      const subject = subjectMatch?.[1] || '';

      // Parse issuer
      const issuerMatch = textOutput.match(/Issuer: (.*)/);
      const issuer = issuerMatch?.[1] || '';

      // Parse validity dates
      const notBeforeMatch = textOutput.match(/Not Before: (.*)/);
      const notAfterMatch = textOutput.match(/Not After : (.*)/);
      const validFrom = notBeforeMatch
        ? new Date(notBeforeMatch[1])
        : new Date();
      const validTo = notAfterMatch ? new Date(notAfterMatch[1]) : new Date();

      // Parse serial number
      const serialMatch = textOutput.match(
        /Serial Number:\s*\n?\s*([a-f0-9:]+)/i,
      );
      const serialNumber = serialMatch?.[1] || '';

      // Parse SANs
      const sanMatch = textOutput.match(
        /X509v3 Subject Alternative Name:\s*\n\s*(.*)/,
      );
      const subjectAltNames = sanMatch?.[1]
        ?.split(',')
        .map((s) => s.trim().replace(/^DNS:/, ''))
        .filter(Boolean);

      return {
        subject,
        issuer,
        validFrom,
        validTo,
        serialNumber,
        subjectAltNames,
      };
    } finally {
      try {
        fs.unlinkSync(certFile);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Validate SSL/TLS certificate chain
   */
  async validateCertificateChain(
    certPem: string,
    chainPem?: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const certFile = `/tmp/cert-chain-${Date.now()}.pem`;
    try {
      const fullChain = chainPem ? `${certPem}\n${chainPem}` : certPem;
      fs.writeFileSync(certFile, fullChain, 'utf8');

      await exec(`openssl verify -CAfile ${certFile} ${certFile}`);
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        fs.unlinkSync(certFile);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Ensure certbot webroot directory exists
   */
  ensureCertbotWebroot(): void {
    const webroot = '/var/www/certbot';
    if (!fs.existsSync(webroot)) {
      this.logger.log(`[Certbot] Creating webroot directory: ${webroot}`);
      fs.mkdirSync(webroot, { recursive: true, mode: 0o755 });
    }
  }
}
