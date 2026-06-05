import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('metrics')
@Public()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getPrometheusMetrics(): Promise<string> {
    const metrics = await this.metricsService.getAllMetrics();
    return this.metricsService.formatPrometheusMetrics(metrics);
  }

  @Get('json')
  async getJsonMetrics() {
    return this.metricsService.getAllMetrics();
  }
}
