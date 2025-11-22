import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';
import { GenerateSelfSignedDto } from './dto/generate-self-signed.dto';
import { CertificateInfoDto } from './dto/certificate-info.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('certificates')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get()
  async listCertificates(): Promise<CertificateInfoDto[]> {
    return this.certificateService.listCertificates();
  }

  @Get(':id')
  async getCertificate(@Param('id') id: string): Promise<CertificateInfoDto> {
    return this.certificateService.getCertificateInfo(id);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  async uploadCertificate(@Body() dto: UploadCertificateDto) {
    try {
      return await this.certificateService.uploadCertificate(dto);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to upload certificate',
      );
    }
  }

  @Post('generate-self-signed')
  @HttpCode(HttpStatus.CREATED)
  async generateSelfSigned(@Body() dto: GenerateSelfSignedDto) {
    try {
      return await this.certificateService.generateSelfSignedCertificate(
        dto.domains,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Failed to generate self-signed certificate',
      );
    }
  }

  @Post('renew/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async renewCertificate(@Param('id') id: string) {
    return this.certificateService.renewCertificateById(id);
  }

  @Post('renew-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async renewAllCertificates() {
    await this.certificateService.renewAllCertificates();
    return { message: 'Certificate renewal process initiated' };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCertificate(@Param('id') id: string) {
    await this.certificateService.deleteCertificate(id);
  }

  @Get('validate/:domain')
  async validateDomain(@Param('domain') domain: string) {
    return this.certificateService.validateDomainForCertificate(domain);
  }

  @Get('health/ocsp-check')
  async checkOcspSupport() {
    return this.certificateService.checkAllCertificatesOcspSupport();
  }
}
