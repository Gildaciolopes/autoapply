import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { ControlController } from './control.controller.js';
import { ControlService } from './control.service.js';

@Module({ imports: [QueuesModule], controllers: [ControlController], providers: [ControlService], exports: [ControlService] })
export class ControlModule {}
