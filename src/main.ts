import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { LogsService } from './logs/logs.service';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logsService = app.get(LogsService);
  app.useLogger(logsService); // <- This makes all Nest logs go through your service

  // Enable global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

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

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
