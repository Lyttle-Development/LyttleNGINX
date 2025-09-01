import { Logger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ReloaderModule } from './reloader/reloader.module';
import { NginxModule } from './nginx/nginx.module';
import { AppService } from './app.service';
import { CertificateModule } from './certificate/certificate.module';
import { HealthModule } from './health/health.module';
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [
    PrismaModule,
    ReloaderModule,
    NginxModule,
    CertificateModule,
    HealthModule,
    LogsModule,
  ],
  providers: [AppService],
  controllers: [AppController],
})
export class AppModule {
  constructor(logsService: import('./logs/logs.service').LogsService) {
    // Use custom logger for NestJS, but preserve stdout for docker logs
    const logger = new Logger('App');
    logger.log = (...args) => {
      logsService.log(args.join(' '));
      process.stdout.write(args.join(' ') + '\n');
    };
    logger.error = (...args) => {
      logsService.error(args.join(' '));
      process.stderr.write(args.join(' ') + '\n');
    };
    logger.warn = (...args) => {
      logsService.warn(args.join(' '));
      process.stdout.write(args.join(' ') + '\n');
    };
    logger.debug = (...args) => {
      logsService.debug(args.join(' '));
      process.stdout.write(args.join(' ') + '\n');
    };
    logger.verbose = (...args) => {
      logsService.verbose(args.join(' '));
      process.stdout.write(args.join(' ') + '\n');
    };
  }
}
