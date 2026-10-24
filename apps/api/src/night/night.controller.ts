import { Body, Controller, Get, Headers, Param, Post, Put, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { NightSettingsBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { NightService } from './night.service.js';

/** F6 overnight runs (specs/006-overnight-runs/contracts/rest-api.md). */
@Controller()
export class NightController {
  constructor(private readonly night: NightService) {}

  @Get('night/settings')
  settings() {
    return this.night.settings();
  }

  @Put('night/settings')
  update(@Body(new ZodPipe(NightSettingsBody)) body: NightSettingsBody) {
    return this.night.updateSettings(body);
  }

  @Post('night/runs')
  async start(@Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.night.startManual();
  }

  @Get('night/runs')
  runs(@Query('limit') limit?: string) {
    return this.night.runs(limit ? Number(limit) : undefined);
  }

  @Get('night/runs/:id')
  run(@Param('id') id: string) {
    return this.night.run(id);
  }

  /** SSE: the browser's EventSource resends `Last-Event-ID` on reconnect → replay without gaps. */
  @Sse('night/runs/:id/events')
  events(@Param('id') id: string, @Headers('last-event-id') lastId?: string, @Query('after') after?: string) {
    return this.night.events(id, Number(lastId ?? after ?? 0));
  }

  @Post('notify/test')
  testTelegram() {
    return this.night.testTelegram();
  }
}
