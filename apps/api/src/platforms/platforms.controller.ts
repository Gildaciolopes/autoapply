import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { ConnectDoneBody, OptInBody, PlatformLimitsBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { PlatformsService } from './platforms.service.js';

/** F5 platforms (specs/005-logged-in-platforms/contracts/rest-api.md). */
@Controller('platforms')
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Get()
  list() {
    return this.platforms.list();
  }

  @Post('linkedin/opt-in')
  optIn(@Body(new ZodPipe(OptInBody)) _body: z.infer<typeof OptInBody>) {
    return this.platforms.optIn();
  }

  @Post(':kind/connect')
  async connect(@Param('kind') kind: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.platforms.connect(kind);
  }

  @Post(':kind/connect/done')
  connectDone(@Param('kind') kind: string, @Body(new ZodPipe(ConnectDoneBody)) body: z.infer<typeof ConnectDoneBody>) {
    return this.platforms.connectDone(kind, body.cancel);
  }

  @Post(':kind/test')
  async test(@Param('kind') kind: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.platforms.test(kind);
  }

  @Delete(':kind/session')
  disconnect(@Param('kind') kind: string) {
    return this.platforms.disconnect(kind);
  }

  @Put(':kind/limits')
  limits(@Param('kind') kind: string, @Body(new ZodPipe(PlatformLimitsBody)) body: PlatformLimitsBody) {
    return this.platforms.limits(kind, body);
  }

  @Post(':kind/resume')
  resume(@Param('kind') kind: string) {
    return this.platforms.resume(kind);
  }
}
