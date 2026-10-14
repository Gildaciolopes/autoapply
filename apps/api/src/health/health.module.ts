import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [QueuesModule], controllers: [HealthController] })
export class HealthModule {}
