import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// Standalone context: no HTTP server, only BullMQ processors.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
const log = new Logger('worker');
if (!/^[0-9a-f]{64}$/i.test(process.env.SESSION_ENCRYPTION_KEY ?? '')) {
  log.warn('SESSION_ENCRYPTION_KEY missing or not 64 hex chars: platform sessions (Gupy/LinkedIn) are disabled');
}
log.log('AutoApply worker started');
