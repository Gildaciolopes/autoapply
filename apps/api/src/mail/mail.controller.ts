import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MailService } from './mail.service.js';

@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  view() {
    return this.mail.view();
  }

  @Get('connect')
  async connect(@Res() res: Response) {
    res.redirect(302, await this.mail.connectUrl());
  }

  @Get('oauth/callback')
  async callback(@Query() q: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    res.redirect(302, await this.mail.callback(q));
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect() {
    return this.mail.disconnect();
  }

  @Post('check')
  @HttpCode(202)
  check() {
    return this.mail.check();
  }
}
