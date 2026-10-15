import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SyncService } from './sync.service.js';
import { ZodPipe } from './zod.pipe.js';

const EnabledBody = z.object({ enabled: z.boolean() });

@Controller('kb')
export class SourcesController {
  constructor(private readonly sync: SyncService) {}

  @Get('sources')
  sources() {
    return this.sync.sources();
  }

  @Patch('sources/:origin')
  setEnabled(@Param('origin') origin: string, @Body(new ZodPipe(EnabledBody)) body: z.infer<typeof EnabledBody>) {
    return this.sync.setEnabled(origin, body.enabled);
  }

  @Post('sources/:origin/import')
  async importNow(@Param('origin') origin: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.sync.importNow(origin);
  }

  @Post('sync')
  async syncNow(@Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.sync.syncNow();
  }

  @Get('sync-runs')
  runs(@Query('limit') limit?: string) {
    return this.sync.runs(limit ? Number(limit) : 10);
  }
}
