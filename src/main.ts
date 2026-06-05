import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import { AppModule } from './app.module';
import { LogsService } from './logs/logs.service';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { AuthenticatedRequest } from './auth/interfaces/authenticated-request.interface';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logsService = app.get(LogsService);
  app.useLogger(logsService);
  app.use(
    (
      request: AuthenticatedRequest,
      response: Response,
      next: () => void,
    ) => logsService.bindRequestContext(request, response, next),
  );

  // Enable global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter(logsService));

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error for non-whitelisted properties
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Allow type coercion
      },
    }),
  );

  await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
