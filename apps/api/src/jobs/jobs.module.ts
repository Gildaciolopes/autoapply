import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { DiscoveryService } from './discovery.service.js';
import { FeedService } from './feed.service.js';
import { flowsProvider } from './flows.provider.js';
import { DiscoveryController, FeedController, JobSourcesController, PreferencesController } from './jobs.controllers.js';
import { PreferencesService } from './preferences.service.js';
import { JobSourcesService } from './sources.service.js';

/** F2 discovery & scoring API (specs/002-job-discovery-scoring/contracts/rest-api.md). */
@Module({
  imports: [QueuesModule],
  controllers: [PreferencesController, JobSourcesController, DiscoveryController, FeedController],
  providers: [PreferencesService, JobSourcesService, DiscoveryService, FeedService, flowsProvider],
})
export class JobsModule {}
