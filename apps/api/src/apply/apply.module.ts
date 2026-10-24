import { Module } from '@nestjs/common';
import { StorageService } from '../kb/storage.service.js';
import { QueuesModule } from '../queues/queues.module.js';
import { ApplyController } from './apply.controller.js';
import { ApplyService } from './apply.service.js';

/** F4 apply engine API (dry-run): simulate, batch, kill switch, review, answer missing questions. */
@Module({ imports: [QueuesModule], controllers: [ApplyController], providers: [ApplyService, StorageService] })
export class ApplyModule {}
