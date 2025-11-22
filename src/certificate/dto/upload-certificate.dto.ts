import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class UploadCertificateDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'Domain names cannot be empty' })
  domains: string[]; // Array of domain names

  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid certificate PEM format',
  })
  certPem: string; // PEM-encoded certificate

  @IsString()
  @Matches(/^-----BEGIN (RSA |EC )?PRIVATE KEY-----/, {
    message: 'Invalid private key PEM format',
  })
  keyPem: string; // PEM-encoded private key

  @IsOptional()
  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid chain PEM format',
  })
  chainPem?: string; // Optional PEM-encoded certificate chain
}
