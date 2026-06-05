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

export class CreateProxyEntryDto {
  @IsArray()
  @IsString({ each: true })
  @NormalizeDomainList({ allowWildcard: true })
  @IsDomainList(
    { allowWildcard: true },
    { message: 'Each domain must be a valid FQDN or wildcard FQDN' },
  )
  domains: string[];

  @IsString()
  proxyPassHost: string;

  @IsOptional()
  @IsString()
  nginxCustomCode?: string;

  @IsEnum(ProxyType)
  type: ProxyType;

  @IsBoolean()
  ssl: boolean;
}
