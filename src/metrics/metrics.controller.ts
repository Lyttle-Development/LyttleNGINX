import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getPrometheusMetrics(): Promise<string> {
    const [certificates, proxies] = await Promise.all([
      this.metricsService.getCertificateMetrics(),
      this.metricsService.getProxyMetrics(),
    ]);

    return this.metricsService.formatPrometheusMetrics({
      certificates,
      proxies,
    });
  }

  @Get('json')
  async getJsonMetrics() {
    const [certificates, proxies] = await Promise.all([
      this.metricsService.getCertificateMetrics(),
      this.metricsService.getProxyMetrics(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      certificates,
      proxies,
    };
  }
}
