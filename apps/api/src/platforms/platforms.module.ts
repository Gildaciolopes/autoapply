import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { PlatformsController } from './platforms.controller.js';
import { PlatformsService } from './platforms.service.js';

@Module({ imports: [QueuesModule], controllers: [PlatformsController], providers: [PlatformsService] })
export class PlatformsModule {}
