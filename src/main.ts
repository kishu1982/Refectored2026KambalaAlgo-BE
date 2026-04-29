import { setServers } from 'node:dns/promises';
// Force Node.js to use public DNS to resolve SRV records
setServers(['1.1.1.1', '8.8.8.8']);

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // IMPORTANT: enables correct client IP from x-forwarded-for
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true, // 🔴 REQUIRED
      },
    }),
  ); // defining gloabally

  // fixing cors for nextjs frontend
  app.enableCors({
    origin: true, // your NextJS frontend alows all origins, you can specify your frontend URL here
    // origin: 'http://localhost:3001', // your NextJS frontend
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // if using cookies/auth
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
