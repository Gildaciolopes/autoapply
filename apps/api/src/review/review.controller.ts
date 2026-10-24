import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EstimateBody, RejectBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { ReviewService } from './review.service.js';

/** F6 review queue (specs/006-overnight-runs/contracts/rest-api.md). */
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('review')
  queue(@Query('run') run?: string) {
    return this.review.queue(run || undefined);
  }

  @Post('review/estimate')
  estimate(@Body(new ZodPipe(EstimateBody)) body: EstimateBody) {
    return this.review.estimate(body.ids);
  }

  @Post('applications/:id/reject')
  reject(@Param('id') id: string, @Body(new ZodPipe(RejectBody)) body: RejectBody) {
    return this.review.reject(id, body.reason);
  }

  @Post('applications/:id/unreject')
  async unreject(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.review.unreject(id);
  }
}
