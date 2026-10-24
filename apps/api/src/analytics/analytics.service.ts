import { Injectable } from '@nestjs/common';
import { funnel } from '@autoapply/db';
import type { FunnelQuery, FunnelView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  funnel(q: FunnelQuery, now = new Date()): Promise<FunnelView> {
    return funnel(this.prisma.client, q, now);
  }
}
