import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GenerateDhParamDto {
  @IsOptional()
  @IsNumber()
  @Min(2048, { message: 'DH parameter bits must be at least 2048' })
  @Max(8192, { message: 'DH parameter bits must not exceed 8192' })
  bits?: number = 2048;
}
