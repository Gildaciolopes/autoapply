import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QUEUES } from '@autoapply/shared';
import { LinkedinMcpClient } from './mcp/linkedin-mcp.client.js';
import { DiscoverProcessor } from './processors/discover.processor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [LinkedinMcpClient, DiscoverProcessor],
})
export class WorkerModule {}
