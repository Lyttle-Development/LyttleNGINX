import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LogsService } from './logs/logs.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logsService = app.get(LogsService);
  app.useLogger(logsService); // <- This makes all Nest logs go through your service
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
