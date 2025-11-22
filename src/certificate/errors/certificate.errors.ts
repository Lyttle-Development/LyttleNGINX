import { HttpException, HttpStatus } from '@nestjs/common';

export class CertificateError extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ message, code, details }, status);
  }
}

export class CertificateNotFoundError extends CertificateError {
  constructor(id: string) {
    super(
      `Certificate not found: ${id}`,
      'CERTIFICATE_NOT_FOUND',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class CertificateValidationError extends CertificateError {
  constructor(message: string, details?: any) {
    super(message, 'CERTIFICATE_VALIDATION_ERROR', details);
  }
}

export class CertificateRenewalError extends CertificateError {
  constructor(domains: string[], originalError: any) {
    super(
      `Failed to renew certificate for ${domains.join(', ')}`,
      'CERTIFICATE_RENEWAL_ERROR',
      { domains, error: String(originalError) },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class CertificateExpiredError extends CertificateError {
  constructor(domains: string[], expiresAt: Date) {
    super(
      `Certificate has expired for ${domains.join(', ')}`,
      'CERTIFICATE_EXPIRED',
      { domains, expiresAt },
      HttpStatus.GONE,
    );
  }
}

export class DomainValidationError extends CertificateError {
  constructor(domain: string, reason: string) {
    super(
      `Domain validation failed for ${domain}: ${reason}`,
      'DOMAIN_VALIDATION_ERROR',
      { domain, reason },
    );
  }
}
