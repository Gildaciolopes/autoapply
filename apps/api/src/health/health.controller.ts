import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.discover) private readonly queue: Queue,
  ) {}

  @Get()
  async check() {
    const [db, redis, ollama] = await Promise.allSettled([
      this.prisma.client.$queryRaw`SELECT 1`,
      this.queue.getJobCounts(),
      fetch(`${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags`).then((r) => r.ok || Promise.reject()),
    ]);
    const ok = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'up' : 'down');
    return { db: ok(db), redis: ok(redis), ollama: ok(ollama) };
  }
}
