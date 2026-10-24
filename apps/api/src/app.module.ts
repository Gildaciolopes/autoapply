import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { KbModule } from './kb/kb.module.js';
import { TailorModule } from './tailor/tailor.module.js';
import { ApplyModule } from './apply/apply.module.js';
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
  ],
})
export class AppModule {}
