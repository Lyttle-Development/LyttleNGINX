import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CertificateBackupService } from './certificate-backup.service';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Audit } from '../audit/decorators/audit.decorator';
import { ImportCertificatesDto } from './dto/import-certificates.dto';

@Controller('certificates/backup')
@AuthorizeAdmin('security-admin')
export class BackupController {
  constructor(private readonly backupService: CertificateBackupService) {}

  @Post()
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'certificate.backup.create' })
  async createBackup() {
    const result = await this.backupService.createBackup();
    return {
      message: 'Backup created successfully',
      filename: result.filename,
    };
  }

  @Get()
  @UseGuards(ApiKeyGuard)
  @Audit({ action: 'certificate.backup.list' })
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Get(':filename')
  @UseGuards(ApiKeyGuard)
  @Audit({ action: 'certificate.backup.download' })
  async downloadBackup(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const stream = await this.backupService.getBackupStream(filename);
    res.set({
      'Content-Type': filename.endsWith('.zip')
        ? 'application/zip'
        : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  @Post(':filename/verify')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'certificate.backup.verify' })
  async verifyBackup(@Param('filename') filename: string) {
    return this.backupService.verifyBackup(filename);
  }

  @Post(':filename/restore')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'certificate.backup.restore' })
  async restoreBackup(@Param('filename') filename: string) {
    return this.backupService.restoreBackup(filename);
  }

  @Delete(':filename')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'certificate.backup.delete' })
  async deleteBackup(@Param('filename') filename: string) {
    await this.backupService.deleteBackup(filename);
  }

  @Post('import')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'certificate.backup.import' })
  async importCertificates(@Body() data: ImportCertificatesDto) {
    return this.backupService.importCertificates(data.certificates);
  }

  @Get('export/:id')
  @AuthorizeAdmin('platform-admin')
  @UseGuards(ApiKeyGuard)
  @Audit({ action: 'certificate.export' })
  async exportCertificate(@Param('id') id: string) {
    return this.backupService.exportCertificate(id);
  }
}
