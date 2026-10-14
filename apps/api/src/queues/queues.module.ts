import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '@autoapply/shared';

const names = Object.values(QUEUES);

/** API only produces jobs; consumers live in apps/worker and services/scraper. */
@Module({
  imports: [
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } }),
    BullModule.registerQueue(...names.map((name) => ({ name }))),
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter }),
    BullBoardModule.forFeature(...names.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
