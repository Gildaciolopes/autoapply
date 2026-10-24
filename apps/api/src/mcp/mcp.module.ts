import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { ApplyModule } from '../apply/apply.module.js';
import { ControlModule } from '../control/control.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { NightModule } from '../night/night.module.js';
import { ReviewModule } from '../review/review.module.js';
import { McpController } from './mcp.controller.js';

@Module({ imports: [JobsModule, ApplyModule, ReviewModule, NightModule, ControlModule, AnalyticsModule], controllers: [McpController] })
export class McpModule {}
