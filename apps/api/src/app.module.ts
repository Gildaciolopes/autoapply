import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { KbModule } from './kb/kb.module.js';
import { TailorModule } from './tailor/tailor.module.js';
import { ApplyModule } from './apply/apply.module.js';
import { PlatformsModule } from './platforms/platforms.module.js';
import { ControlModule } from './control/control.module.js';
import { ReviewModule } from './review/review.module.js';
import { MemoriesModule } from './memories/memories.module.js';
import { NightModule } from './night/night.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { MailModule } from './mail/mail.module.js';
import { RepliesModule } from './replies/replies.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueuesModule } from './queues/queues.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
    QueuesModule,
    HealthModule,
    KbModule,
    JobsModule,
    TailorModule,
    ApplyModule,
    PlatformsModule,
    NightModule,
    ControlModule,
    ReviewModule,
    MemoriesModule,
    AnalyticsModule,
    MailModule,
    RepliesModule,
    AssistantModule,
    McpModule,
  ],
})
export class AppModule {}
