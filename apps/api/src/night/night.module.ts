import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { NightController } from './night.controller.js';
import { NightService } from './night.service.js';

@Module({ imports: [QueuesModule], controllers: [NightController], providers: [NightService], exports: [NightService] })
export class NightModule {}
