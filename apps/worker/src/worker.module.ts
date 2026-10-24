import { BullModule } from '@nestjs/bullmq';
import { Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createPrismaClient } from '@autoapply/db';
import { ollamaFromEnv } from '@autoapply/llm';
import { QUEUES } from '@autoapply/shared';
import { S3BlobStore, type KbDeps } from './kb/deps.js';
import { LinkedinMcpClient } from './mcp/linkedin-mcp.client.js';
import { DiscoverProcessor } from './processors/discover.processor.js';
import { ScoreProcessor } from './processors/score.processor.js';
import { TailorProcessor } from './processors/tailor.processor.js';
import { ApplyProcessor } from './processors/apply.processor.js';
import { NightProcessor } from './processors/night.processor.js';
import { NotifyProcessor } from './processors/notify.processor.js';
import { MailProcessor } from './processors/mail.processor.js';
import { KB_DEPS, SyncProfileProcessor } from './processors/sync-profile.processor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [
    LinkedinMcpClient,
    DiscoverProcessor,
    SyncProfileProcessor,
    ScoreProcessor,
    TailorProcessor,
    ApplyProcessor,
    NightProcessor,
    NotifyProcessor,
    MailProcessor,
    {
      provide: KB_DEPS,
      useFactory: (): KbDeps => ({
        db: createPrismaClient(),
        storage: new S3BlobStore(),
        llm: ollamaFromEnv(),
        models: {
          chat: process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b',
          vision: process.env.OLLAMA_VISION_MODEL ?? 'qwen2.5vl:7b',
        },
      }),
    },
  ],
})
export class WorkerModule implements OnModuleDestroy {
  constructor(@Inject(KB_DEPS) private readonly deps: KbDeps) {}

  async onModuleDestroy() {
    await this.deps.db.$disconnect();
  }
}
