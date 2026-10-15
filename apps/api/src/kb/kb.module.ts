import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { QueuesModule } from '../queues/queues.module.js';
import { ApiErrorFilter } from './api-error.js';
import { ConflictsController } from './conflicts.controller.js';
import { ConflictsService } from './conflicts.service.js';
import { FactsController } from './facts.controller.js';
import { FactsService } from './facts.service.js';
import { RenderController } from './render.controller.js';
import { ResumesController } from './resumes.controller.js';
import { ResumesService } from './resumes.service.js';
import { SourcesController } from './sources.controller.js';
import { StorageService } from './storage.service.js';
import { SyncService } from './sync.service.js';

/** F1 Knowledge base REST API (contracts/rest-api.md). */
@Module({
  imports: [QueuesModule],
  controllers: [ResumesController, FactsController, ConflictsController, SourcesController, RenderController],
  providers: [
    ResumesService,
    FactsService,
    ConflictsService,
    SyncService,
    StorageService,
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class KbModule {}
