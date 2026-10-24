import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ManualReplyBody, ReplyPatchBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { RepliesService } from './replies.service.js';

@Controller()
export class RepliesController {
  constructor(private readonly replies: RepliesService) {}

  @Get('replies')
  list(@Query('review') review?: string, @Query('applicationId') applicationId?: string) {
    return this.replies.list({ review: review === 'true', applicationId });
  }

  @Get('applications/:id/replies')
  forApplication(@Param('id') id: string) {
    return this.replies.list({ applicationId: id });
  }

  @Post('applications/:id/replies')
  manual(@Param('id') id: string, @Body(new ZodPipe(ManualReplyBody)) body: ManualReplyBody) {
    return this.replies.manual(id, body);
  }

  @Patch('replies/:id')
  patch(@Param('id') id: string, @Body(new ZodPipe(ReplyPatchBody)) body: ReplyPatchBody) {
    return this.replies.patch(id, body);
  }

  @Delete('replies/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.replies.remove(id);
  }
}
