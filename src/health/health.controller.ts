import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Liveness probe
  @Get('health')
  @HttpCode(HttpStatus.OK)
  live() {
    return this.healthService.live();
  }

  // Readiness probe (checks nginx + config)
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  ready() {
    return this.healthService.ready();
  }
}