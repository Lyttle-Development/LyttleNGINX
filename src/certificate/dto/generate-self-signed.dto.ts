import { IsArray, IsString, MinLength } from 'class-validator';

export class GenerateSelfSignedDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'Domain names cannot be empty' })
  domains: string[];
}
