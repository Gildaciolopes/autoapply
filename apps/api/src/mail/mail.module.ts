import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module.js';
import { MailController } from './mail.controller.js';
import { MailService } from './mail.service.js';

@Module({ imports: [QueuesModule], controllers: [MailController], providers: [MailService], exports: [MailService] })
export class MailModule {}
