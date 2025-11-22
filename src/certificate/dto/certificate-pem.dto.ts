import { IsString, Matches } from 'class-validator';

export class CertificatePemDto {
  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid certificate PEM format',
  })
  certPem: string;
}
