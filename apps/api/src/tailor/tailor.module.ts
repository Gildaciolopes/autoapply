import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { TailorController } from './tailor.controller.js';
import { TailorService } from './tailor.service.js';

/** F3 tailoring API (specs/003-tailoring/contracts/rest-api.md). */
@Module({ imports: [QueuesModule], controllers: [TailorController], providers: [TailorService] })
export class TailorModule {}
