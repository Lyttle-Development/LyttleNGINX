import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RotateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  nextApiKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  issueBridgeToken?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  retireApiKeyId?: string;
}
