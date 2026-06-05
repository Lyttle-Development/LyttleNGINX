import { IsArray, IsOptional, IsString, Matches } from 'class-validator';
import { IsDomainList, NormalizeDomainList } from './domain-list.decorator';

export class UploadCertificateDto {
  @IsArray()
  @IsString({ each: true })
  @NormalizeDomainList({ allowWildcard: true })
  @IsDomainList(
    { allowWildcard: true },
    { message: 'Each domain must be a valid FQDN or wildcard FQDN' },
  )
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
