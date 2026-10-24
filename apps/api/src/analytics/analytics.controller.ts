import { Controller, Get, Query } from '@nestjs/common';
import { FunnelQuery } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('funnel')
  funnel(@Query(new ZodPipe(FunnelQuery)) q: FunnelQuery) {
    return this.analytics.funnel(q);
  }
}
