import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// Beberapa tabel warisan (mis. public.users di acca_db) memakai bigint sebagai
// primary key. JSON.stringify melempar untuk BigInt, jadi dipasang serializer
// global — sama seperti apps/api di acca-new.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = Number(configService.get('PORT')) || 3009;
  const host = configService.get<string>('HOST') || '127.0.0.1';
  const rawOrigins = configService.get<string>('CORS_ORIGIN') || '*';
  const origins = rawOrigins === '*' ? '*' : rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ACCA CBT Backend API')
    .setDescription('REST API NestJS untuk aplikasi CBT (ujian berbasis komputer)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  // Bind ke HOST (default loopback). Ekspos ke 0.0.0.0 hanya jika reverse proxy
  // di depannya benar-benar membatasi akses — endpoint ini tidak dirancang publik.
  await app.listen(port, host);
  logger.log(`NestJS CBT backend berjalan di http://${host}:${port}/api`);
  logger.log(`Dokumentasi Swagger: http://${host}:${port}/api/docs`);
}

void bootstrap();
