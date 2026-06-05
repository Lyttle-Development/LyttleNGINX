import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDomainList, NormalizeDomainList } from './domain-list.decorator';

export class ImportCertificateEntryDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @NormalizeDomainList({ allowWildcard: true })
  @IsDomainList(
    { allowWildcard: true },
    { message: 'Each domain must be a valid FQDN or wildcard FQDN' },
  )
  domains: string[];

  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid certificate PEM format',
  })
  certPem: string;

  @IsString()
  @Matches(/^-----BEGIN (RSA |EC )?PRIVATE KEY-----/, {
    message: 'Invalid private key PEM format',
  })
  keyPem: string;

  @IsISO8601({ strict: true }, { message: 'issuedAt must be an ISO-8601 timestamp' })
  issuedAt: string;

  @IsISO8601({ strict: true }, { message: 'expiresAt must be an ISO-8601 timestamp' })
  expiresAt: string;
}

export class ImportCertificatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportCertificateEntryDto)
  certificates: ImportCertificateEntryDto[];
}

