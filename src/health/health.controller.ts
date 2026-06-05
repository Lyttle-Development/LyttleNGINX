import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller()
@Public()
export class HealthController {
  private readonly probeService: HealthService;

  constructor(service: HealthService) {
    this.probeService = service;
  }

  @Get('health/live')
  async live(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.live();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('health')
  async healthAlias(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.live();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('health/startup')
  async startup(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.startup();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('health/ready')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.ready();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('health/dependencies')
  async dependencies(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.dependencies();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('health/deep')
  async deep(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.deep();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  @Get('ready')
  async readyAlias(@Res({ passthrough: true }) response: Response) {
    const report = await this.probeService.ready();
    this.applyProbeStatus(response, report.status);
    return report;
  }

  private applyProbeStatus(response: Response, status: string) {
    response.status(
      status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}