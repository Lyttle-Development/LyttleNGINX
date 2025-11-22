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
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-auth.guard';

@Controller('certificates/backup')
export class BackupController {
  constructor(private readonly backupService: CertificateBackupService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createBackup() {
    const result = await this.backupService.createBackup();
    return {
      message: 'Backup created successfully',
      filename: result.filename,
    };
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Get(':filename')
  @UseGuards(JwtAuthGuard)
  async downloadBackup(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const stream = await this.backupService.getBackupStream(filename);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  @Delete(':filename')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBackup(@Param('filename') filename: string) {
    await this.backupService.deleteBackup(filename);
  }

  @Post('import')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async importCertificates(@Body() data: any) {
    return this.backupService.importCertificates(data.certificates);
  }

  @Get('export/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async exportCertificate(@Param('id') id: string) {
    return this.backupService.exportCertificate(id);
  }
}
