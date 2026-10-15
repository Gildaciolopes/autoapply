import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { JobsQuery, PatchJobBody, PatchSourceBody, Preferences } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { DiscoveryService } from './discovery.service.js';
import { FeedService } from './feed.service.js';
import { PreferencesService } from './preferences.service.js';
import { JobSourcesService } from './sources.service.js';

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly prefs: PreferencesService) {}

  @Get()
  get() {
    return this.prefs.get();
  }

  @Get('suggest')
  suggest() {
    return this.prefs.suggest();
  }

  @Put()
  async put(@Body(new ZodPipe(Preferences)) body: z.infer<typeof Preferences>, @Res({ passthrough: true }) res: Response) {
    const { prefs, refiltered } = await this.prefs.put(body);
    res.setHeader('x-refiltered', String(refiltered));
    res.setHeader('access-control-expose-headers', 'x-refiltered');
    return prefs;
  }
}

@Controller('sources')
export class JobSourcesController {
  constructor(private readonly sources: JobSourcesService) {}

  @Get()
  list() {
    return this.sources.list();
  }

  @Patch(':type')
  patch(@Param('type') type: string, @Body(new ZodPipe(PatchSourceBody)) body: z.infer<typeof PatchSourceBody>) {
    return this.sources.patch(type, body);
  }
}

const RescoreBody = z.object({ judge: z.boolean().default(true) });

@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('discovery/runs')
  async start(@Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.discovery.start();
  }

  @Get('discovery/runs')
  list(@Query('limit') limit?: string) {
    return this.discovery.list(limit ? Number(limit) : 10);
  }

  @Get('discovery/runs/:id')
  get(@Param('id') id: string) {
    return this.discovery.get(id);
  }

  @Post('scoring/rescore')
  async rescore(@Body(new ZodPipe(RescoreBody)) body: z.infer<typeof RescoreBody>, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.discovery.rescore(body.judge);
  }
}

@Controller('jobs')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@Query(new ZodPipe(JobsQuery)) q: z.infer<typeof JobsQuery>) {
    return this.feed.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.feed.get(id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body(new ZodPipe(PatchJobBody)) body: z.infer<typeof PatchJobBody>) {
    return this.feed.patch(id, body);
  }

  @Post(':id/block-company')
  block(@Param('id') id: string) {
    return this.feed.blockCompany(id);
  }
}
