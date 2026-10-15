import { Body, Controller, HttpCode, Post, Res, type OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { factsForMode } from '@autoapply/db';
import { atsLint, closeRenderer, factsToRenderModel, renderResumePdf, type RenderModel } from '@autoapply/resume';
import { RenderRequest } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';
import { ZodPipe } from './zod.pipe.js';

@Controller('kb/render')
export class RenderController implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await closeRenderer();
  }

  /** Usable facts only (FR-003/FR-020); dryRun also shows unverified ones with a watermark. */
  private async model(req: z.infer<typeof RenderRequest>): Promise<RenderModel> {
    const db = this.prisma.client;
    const [profile, facts] = await Promise.all([
      db.profile.findUnique({ where: { id: 'me' } }),
      db.fact.findMany({ where: factsForMode(req.dryRun ? 'dry_run' : 'review'), select: { id: true, kind: true, value: true } }),
    ]);
    if (!profile) throw new ApiError(409, 'no_profile', 'confirme um currículo antes de renderizar');
    return factsToRenderModel(
      profile,
      facts.filter((f) => f.kind !== 'personal' && f.kind !== 'preference'),
      { hiddenItemIds: req.hiddenItemIds, lang: req.lang, watermark: req.dryRun ? 'DRY-RUN — contém fatos não verificados' : undefined },
    );
  }

  @Post()
  @HttpCode(200)
  async render(@Body(new ZodPipe(RenderRequest)) body: z.infer<typeof RenderRequest>, @Res() res: Response) {
    const model = await this.model(body);
    const r = await renderResumePdf(model);
    if (r.overflow) throw new ApiError(422, 'overflow', `o currículo ocupa ${r.pages} páginas`, { pages: r.pages, items: r.items });
    const lint = await atsLint(r.pdf, model);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="curriculo.pdf"');
    res.setHeader('x-ats-score', String(lint.score));
    res.setHeader('x-pages', '1');
    res.setHeader('access-control-expose-headers', 'x-ats-score, x-pages');
    res.end(r.pdf);
  }

  @Post('lint')
  @HttpCode(200)
  async lint(@Body(new ZodPipe(RenderRequest)) body: z.infer<typeof RenderRequest>) {
    const model = await this.model(body);
    const r = await renderResumePdf(model);
    if (r.overflow) {
      return { score: 0, checks: [{ id: 'one_page', pass: false, detail: `${r.pages} páginas` }], overflow: { pages: r.pages, items: r.items } };
    }
    return atsLint(r.pdf, model);
  }
}
