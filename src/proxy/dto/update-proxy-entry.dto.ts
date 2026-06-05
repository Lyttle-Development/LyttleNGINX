import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ProxyType } from '@prisma/client';
import {
  IsDomainList,
  NormalizeDomainList,
} from '../../certificate/dto/domain-list.decorator';

export class UpdateProxyEntryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @NormalizeDomainList({ allowWildcard: true })
  @IsDomainList(
    { allowWildcard: true },
    { message: 'Each domain must be a valid FQDN or wildcard FQDN' },
  )
  domains?: string[];

  @IsOptional()
  @IsString()
  proxyPassHost?: string;

  @IsOptional()
  @IsString()
  nginxCustomCode?: string;

  @IsOptional()
  @IsEnum(ProxyType)
  type?: ProxyType;

  @IsOptional()
  @IsBoolean()
  ssl?: boolean;
}
