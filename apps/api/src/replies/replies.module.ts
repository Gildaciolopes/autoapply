import { Module } from '@nestjs/common';
import { RepliesController } from './replies.controller.js';
import { RepliesService } from './replies.service.js';

@Module({ controllers: [RepliesController], providers: [RepliesService], exports: [RepliesService] })
export class RepliesModule {}
