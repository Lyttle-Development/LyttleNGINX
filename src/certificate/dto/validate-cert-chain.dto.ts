import { IsOptional, IsString, Matches } from 'class-validator';

export class ValidateCertChainDto {
  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid certificate PEM format',
  })
  certPem: string;

  @IsOptional()
  @IsString()
  @Matches(/^-----BEGIN CERTIFICATE-----/, {
    message: 'Invalid chain PEM format',
  })
  chainPem?: string;
}
