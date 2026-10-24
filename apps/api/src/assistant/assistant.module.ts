import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller.js';

@Module({ controllers: [AssistantController] })
export class AssistantModule {}
