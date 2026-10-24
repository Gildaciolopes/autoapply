import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApplyBatchBody, ApproveBatchBody, MarkBody, UserAnswersBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { ApplyService } from './apply.service.js';

/** F4 apply dry-run (specs/004-apply-engine-dry-run/contracts/rest-api.md). */
@Controller()
export class ApplyController {
  constructor(private readonly apply: ApplyService) {}

  @Post('jobs/:id/apply')
  async start(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.apply.apply(id);
  }

  @Post('apply/batch')
  async batch(@Body(new ZodPipe(ApplyBatchBody)) body: ApplyBatchBody, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.apply.batch(body);
  }

  @Post('apply/stop')
  stop() {
    return this.apply.stop();
  }

  @Get('applications')
  list(@Query('status') status?: string) {
    return this.apply.list(status || undefined);
  }

  @Get('applications/summary')
  summary() {
    return this.apply.summary();
  }

  @Get('applications/:id')
  view(@Param('id') id: string) {
    return this.apply.view(id);
  }

  @Get('applications/:id/artifacts/:artifactId')
  async artifact(@Param('id') id: string, @Param('artifactId') artifactId: string, @Res() res: Response) {
    const png = await this.apply.artifact(id, artifactId);
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.end(png);
  }

  @Post('applications/:id/answers')
  answers(@Param('id') id: string, @Body(new ZodPipe(UserAnswersBody)) body: UserAnswersBody) {
    return this.apply.answers(id, body);
  }

  @Post('applications/:id/rerun')
  async rerun(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.apply.rerun(id);
  }

  @Post('applications/approve')
  async approveBatch(@Body(new ZodPipe(ApproveBatchBody)) body: ApproveBatchBody, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.apply.approveBatch(body.ids);
  }

  @Post('applications/:id/approve')
  async approve(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.apply.approve(id);
  }

  @Post('applications/:id/mark')
  mark(@Param('id') id: string, @Body(new ZodPipe(MarkBody)) body: { sent: boolean }) {
    return this.apply.mark(id, body.sent);
  }
}
