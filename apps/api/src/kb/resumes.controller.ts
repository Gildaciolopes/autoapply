import { Body, Controller, Get, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { z } from 'zod';
import { ConfirmResumeBody, RetryResumeBody } from '@autoapply/shared';
import { ZodPipe } from './zod.pipe.js';
import { MAX_RESUME_BYTES, ResumesService, type UploadedFile as File } from './resumes.service.js';

@Controller('kb/resumes')
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RESUME_BYTES } }))
  async upload(@UploadedFile() file: File | undefined, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.resumes.upload(file);
  }

  @Get()
  list() {
    return this.resumes.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.resumes.get(id);
  }

  @Get(':id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.resumes.file(id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline');
    res.end(buf);
  }

  @Put(':id/draft')
  saveDraft(@Param('id') id: string, @Body() body: unknown) {
    return this.resumes.saveDraft(id, body);
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string, @Body(new ZodPipe(RetryResumeBody)) body: z.infer<typeof RetryResumeBody>, @Res({ passthrough: true }) res: Response) {
    res.status(202);
    return this.resumes.retry(id, body.mode);
  }

  @Post(':id/manual')
  manual(@Param('id') id: string) {
    return this.resumes.manual(id);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body(new ZodPipe(ConfirmResumeBody)) body: z.infer<typeof ConfirmResumeBody>) {
    return this.resumes.confirm(id, body.acceptFlagged);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string) {
    return this.resumes.discard(id);
  }
}
