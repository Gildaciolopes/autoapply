import { Module } from '@nestjs/common';
import { MemoriesController } from './memories.controller.js';
import { MemoriesService } from './memories.service.js';

@Module({ controllers: [MemoriesController], providers: [MemoriesService] })
export class MemoriesModule {}
