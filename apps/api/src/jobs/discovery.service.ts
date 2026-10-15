import { Inject, Injectable } from '@nestjs/common';
import { loadPreferences, startDiscoveryFlow, type FlowAdder } from '@autoapply/db';
import type { DiscoveryRunView } from '@autoapply/shared';
import type { DiscoveryRun } from '@autoapply/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';
import { DISCOVERY_FLOWS } from './flows.provider.js';

const view = (r: DiscoveryRun): DiscoveryRunView => ({
  id: r.id,
  trigger: r.trigger,
  localDate: r.localDate,
  status: r.status,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  outcomes: r.outcomes as DiscoveryRunView['outcomes'],
  judged: r.judged,
});

/** A run left `running` longer than this is considered stuck and does not block new runs. */
const STALE_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DISCOVERY_FLOWS) private readonly flows: FlowAdder,
  ) {}

  private async guard() {
    const running = await this.prisma.client.discoveryRun.findFirst({ where: { status: 'running', startedAt: { gt: new Date(Date.now() - STALE_MS) } } });
    if (running) throw new ApiError(409, 'run_in_progress', 'já existe uma busca em andamento', { runId: running.id });
  }

  async start(): Promise<{ runId: string }> {
    await this.guard();
    const prefs = await loadPreferences(this.prisma.client);
    if (!prefs.roles.length) throw new ApiError(412, 'no_preferences', 'defina ao menos um cargo nas preferências');
    const { runId } = await startDiscoveryFlow(this.prisma.client, this.flows, 'manual');
    return { runId };
  }

  async rescore(judge: boolean): Promise<{ runId: string }> {
    await this.guard();
    const { runId } = await startDiscoveryFlow(this.prisma.client, this.flows, 'rescore', { judge });
    return { runId };
  }

  async list(limit = 10): Promise<DiscoveryRunView[]> {
    return (await this.prisma.client.discoveryRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(limit, 50) })).map(view);
  }

  async get(id: string): Promise<DiscoveryRunView> {
    const r = await this.prisma.client.discoveryRun.findUnique({ where: { id } });
    if (!r) throw new ApiError(404, 'not_found', 'busca não encontrada');
    return view(r);
  }
}
