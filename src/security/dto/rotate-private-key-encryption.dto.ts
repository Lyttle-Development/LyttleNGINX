import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RotatePrivateKeyEncryptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  confirmKeyVersion!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}
