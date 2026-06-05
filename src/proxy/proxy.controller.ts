import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { Audit } from '../audit/decorators/audit.decorator';
import { CreateProxyEntryDto } from './dto/create-proxy-entry.dto';
import { UpdateProxyEntryDto } from './dto/update-proxy-entry.dto';
import { ProxyService } from './proxy.service';

@Controller('proxies')
@AuthorizeAdmin('viewer')
export class ProxyController {
  private readonly proxyService: ProxyService;

  constructor(proxyService: ProxyService) {
    this.proxyService = proxyService;
  }

  @Get()
  async listProxies() {
    return this.proxyService.listProxies();
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'proxy.validate-draft' })
  async validateDraftProxy(@Body() dto: CreateProxyEntryDto) {
    return this.proxyService.validateDraftProxy(dto);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'proxy.validate' })
  async validateStoredProxy(@Param('id', ParseIntPipe) id: number) {
    return this.proxyService.validateStoredProxy(id);
  }

  @Post(':id/test-upstream')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('operator')
  @Audit({ action: 'proxy.test-upstream' })
  async testProxyUpstream(@Param('id', ParseIntPipe) id: number) {
    return this.proxyService.testProxyUpstream(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'proxy.create' })
  async createProxy(@Body() dto: CreateProxyEntryDto) {
    return this.proxyService.createProxy(dto);
  }

  @Get(':id')
  async getProxy(@Param('id', ParseIntPipe) id: number) {
    return this.proxyService.getProxy(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'proxy.update' })
  async updateProxy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProxyEntryDto,
  ) {
    return this.proxyService.updateProxy(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'proxy.delete' })
  async deleteProxy(@Param('id', ParseIntPipe) id: number) {
    return this.proxyService.deleteProxy(id);
  }
}
