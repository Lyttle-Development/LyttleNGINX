export class CertificateInfoDto {
  id: string;
  domains: string[];
  expiresAt: Date;
  issuedAt: Date;
  lastUsedAt: Date;
  isOrphaned: boolean;
  daysUntilExpiry: number;
  status: 'valid' | 'expiring_soon' | 'expired';
}
