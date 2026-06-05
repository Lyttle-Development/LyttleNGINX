import { IsArray, IsString } from 'class-validator';
import { IsDomainList, NormalizeDomainList } from './domain-list.decorator';

export class GenerateSelfSignedDto {
  @IsArray()
  @IsString({ each: true })
  @NormalizeDomainList({ allowWildcard: true })
  @IsDomainList(
    { allowWildcard: true },
    { message: 'Each domain must be a valid FQDN or wildcard FQDN' },
  )
  domains: string[];
}
