import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
app.enableShutdownHooks();
// Loopback by default: the API serves the user's resume and personal facts without auth (single user).
await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '127.0.0.1');
