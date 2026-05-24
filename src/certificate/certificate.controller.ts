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
  CertificateOrderDetailDto,
  CertificateOrderSummaryDto,
} from './dto/certificate-order.dto';
import {
  AuthorizeAdmin,
  AuthorizeInternalNodeOrAdmin,
} from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Audit } from '../audit/decorators/audit.decorator';
import { NormalizedDomainPipe } from '../utils/pipes/normalized-domain.pipe';

@Controller('certificates')
@AuthorizeAdmin('viewer')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get()
  async listCertificates(): Promise<CertificateInfoDto[]> {
    return this.certificateService.listCertificates();
  }

  @Get('orders')
  async listCertificateOrders(
    @Query('limit') limit?: string,
  ): Promise<{ count: number; orders: CertificateOrderSummaryDto[] }> {
    const parsedLimit =
      typeof limit === 'string' && limit.trim().length > 0
        ? Number.parseInt(limit, 10)
        : undefined;

    if (
      parsedLimit !== undefined &&
      (!Number.isFinite(parsedLimit) || parsedLimit <= 0)
    ) {
      throw new BadRequestException(
        'Query parameter "limit" must be a positive integer',
      );
    }

    return this.certificateService.listCertificateOrders(parsedLimit);
  }

  @Get('orders/:id')
  async getCertificateOrder(
    @Param('id') id: string,
  ): Promise<CertificateOrderDetailDto> {
    return this.certificateService.getCertificateOrder(id);
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

  @Post('orders/:id/retry')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'certificate.order.retry' })
  async retryCertificateOrder(
    @Param('id') id: string,
  ): Promise<CertificateOrderDetailDto> {
    try {
      return await this.certificateService.retryCertificateOrder(id);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Failed to retry certificate order',
      );
    }
  }

  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('security-admin')
  @Audit({ action: 'certificate.rollback' })
  async rollbackCertificate(@Param('id') id: string) {
    try {
      return await this.certificateService.rollbackCertificate(id);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to roll back certificate',
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
  async validateDomain(
    @Param('domain', new NormalizedDomainPipe()) domain: string,
  ) {
    return this.certificateService.validateDomainForCertificate(domain);
  }

  @Get('health/ocsp-check')
  async checkOcspSupport() {
    return this.certificateService.checkAllCertificatesOcspSupport();
  }

  @Post('artifacts/:artifactId/activate')
  @HttpCode(HttpStatus.OK)
  @AuthorizeInternalNodeOrAdmin('platform-admin')
  @Audit({ action: 'certificate.artifact.activate' })
  async activateArtifact(
    @Param('artifactId') artifactId: string,
    @Query('operationId') operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.certificateService.activateCertificateArtifact(
        artifactId,
        operationId,
      );

      return operationId
        ? {
            operationId,
            status: 'succeeded',
            ...result,
          }
        : result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to activate artifact';

      if (operationId) {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR);
        return {
          operationId,
          status: 'failed',
          artifactId,
          error: message,
        };
      }

      throw new BadRequestException(message);
    }
  }

  @Get(':id')
  async getCertificate(@Param('id') id: string): Promise<CertificateInfoDto> {
    return this.certificateService.getCertificateInfo(id);
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
