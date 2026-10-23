import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { PatchTailoredBody, TailorRequest } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { TailorService } from './tailor.service.js';

@Controller()
export class TailorController {
  constructor(private readonly tailor: TailorService) {}

  @Post('jobs/:id/tailor')
  async start(@Param('id') id: string, @Body(new ZodPipe(TailorRequest)) body: z.infer<typeof TailorRequest>, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.tailor.tailor(id, body.coverLetter);
  }

  @Get('jobs/:id/tailored')
  forJob(@Param('id') id: string) {
    return this.tailor.forJob(id);
  }

  @Get('tailored/:docId/diff')
  diff(@Param('docId') id: string) {
    return this.tailor.diff(id);
  }

  @Patch('tailored/:docId')
  patch(@Param('docId') id: string, @Body(new ZodPipe(PatchTailoredBody)) body: z.infer<typeof PatchTailoredBody>) {
    return this.tailor.patch(id, body);
  }

  @Post('tailored/:docId/approve')
  approve(@Param('docId') id: string) {
    return this.tailor.approve(id);
  }

  @Post('tailored/:docId/regenerate')
  async regenerate(@Param('docId') id: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.tailor.regenerate(id);
  }

  @Get('tailored/:docId/pdf')
  async pdf(@Param('docId') id: string, @Res() res: Response) {
    const { pdf, name } = await this.tailor.pdf(id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${name}"`);
    res.end(pdf);
  }

  @Get('eval/runs')
  evalRuns(@Query('suite') suite?: string) {
    return this.tailor.evalRuns(suite || 'tailor');
  }
}
