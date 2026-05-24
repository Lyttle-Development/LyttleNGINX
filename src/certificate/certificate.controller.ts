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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CertificateService } from './certificate.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';
import { GenerateSelfSignedDto } from './dto/generate-self-signed.dto';
import { CertificateInfoDto } from './dto/certificate-info.dto';
import {
  AuthorizeAdmin,
  AuthorizeInternalNodeOrAdmin,
} from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('certificates')
@AuthorizeAdmin('viewer')
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
  @AuthorizeAdmin('security-admin')
  @Audit({
    action: 'certificate.upload',
    target: (request, responseBody) => ({
      type: 'certificate',
      id:
        typeof (responseBody as Record<string, unknown> | undefined)?.['id'] ===
        'string'
          ? ((responseBody as Record<string, unknown>)['id'] as string)
          : undefined,
      label: Array.isArray(request.body?.['domains'])
        ? request.body['domains']
            .filter(
              (domain): domain is string =>
                typeof domain === 'string' && domain.trim().length > 0,
            )
            .join(',')
        : undefined,
    }),
  })
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
  @AuthorizeAdmin('security-admin')
  @Audit({
    action: 'certificate.generate-self-signed',
    target: (request, responseBody) => ({
      type: 'certificate',
      id:
        typeof (responseBody as Record<string, unknown> | undefined)?.['id'] ===
        'string'
          ? ((responseBody as Record<string, unknown>)['id'] as string)
          : undefined,
      label: Array.isArray(request.body?.['domains'])
        ? request.body['domains']
            .filter(
              (domain): domain is string =>
                typeof domain === 'string' && domain.trim().length > 0,
            )
            .join(',')
        : undefined,
    }),
  })
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
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'certificate.renew' })
  async renewCertificate(@Param('id') id: string) {
    return this.certificateService.renewCertificateById(id);
  }

  @Post('renew-all')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'certificate.renew-all' })
  async renewAllCertificates() {
    await this.certificateService.renewAllCertificates();
    return { message: 'Certificate renewal process initiated' };
  }

  @Delete(':id')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthorizeAdmin('security-admin')
  @Audit({ action: 'certificate.delete' })
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

  /**
   * Sync certificates from database to filesystem
   * This endpoint is used by other nodes to trigger immediate sync after cert changes
   * No auth required as it's an internal cluster operation
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @AuthorizeInternalNodeOrAdmin('platform-admin')
  @Audit({ action: 'certificate.sync' })
  async syncCertificates(
    @Query('operationId') operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.certificateService.syncCertificates();

    if (operationId && !result.success) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return operationId
      ? {
          operationId,
          status: result.success ? 'succeeded' : 'failed',
          syncedCount: result.syncedCount,
          errors: result.errors,
        }
      : result;
  }
}
