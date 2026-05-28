import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RotateInternalCertsDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  maintenanceWindow?: string;
}
