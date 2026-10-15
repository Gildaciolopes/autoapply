import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sourceBudgets } from '@autoapply/db';
import type { JobSourceType, SourceView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

const DEFAULTS: { type: JobSourceType; enabled: boolean; dailyCap: number }[] = [
  { type: 'gupy', enabled: true, dailyCap: 50 },
  { type: 'indeed', enabled: true, dailyCap: 50 },
  { type: 'glassdoor', enabled: true, dailyCap: 50 },
  { type: 'google_jobs', enabled: true, dailyCap: 50 },
  { type: 'linkedin_mcp', enabled: false, dailyCap: 15 }, // opt-in, ToS risk (FR-003)
];

export const LINKEDIN_WARNING =
  'Os termos do LinkedIn proíbem automação. A busca usa só ferramentas de leitura da sua sessão, com limite baixo; use por sua conta e risco.';

@Injectable()
export class JobSourcesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  /** Seeds missing rows only; never overwrites user changes. */
  async onModuleInit() {
    for (const d of DEFAULTS) {
      await this.prisma.client.source.upsert({ where: { type: d.type }, create: d, update: {} });
    }
  }

  async list(): Promise<SourceView[]> {
    const rows = await sourceBudgets(this.prisma.client);
    return rows
      .filter((b) => DEFAULTS.some((d) => d.type === b.type))
      .map((b) => ({
        type: b.type,
        enabled: b.enabled,
        dailyCap: b.dailyCap,
        usedToday: b.usedToday,
        lastStatus: b.row.lastStatus,
        lastError: b.row.lastError,
        lastRunAt: b.row.lastRunAt?.toISOString() ?? null,
        warning: b.type === 'linkedin_mcp' ? LINKEDIN_WARNING : null,
      }));
  }

  async patch(typeRaw: string, body: { enabled?: boolean; dailyCap?: number; acceptTerms?: boolean }): Promise<SourceView> {
    const def = DEFAULTS.find((d) => d.type === typeRaw);
    if (!def) throw new ApiError(404, 'unknown_source', 'fonte desconhecida');
    if (def.type === 'linkedin_mcp' && body.enabled === true && !body.acceptTerms) {
      throw new ApiError(409, 'terms_required', 'aceite o aviso sobre os termos do LinkedIn para ativar');
    }
    await this.prisma.client.source.update({
      where: { type: def.type },
      data: { ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.dailyCap !== undefined ? { dailyCap: body.dailyCap } : {}) },
    });
    return (await this.list()).find((s) => s.type === def.type)!;
  }
}
