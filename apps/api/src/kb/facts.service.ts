import { Injectable } from '@nestjs/common';
import { applyMerge, type Prisma } from '@autoapply/db';
import { factKey, factsToPersonal, mergeCandidates, personalToCandidates } from '@autoapply/kb';
import { FactValueSchemas, type FactKind, type FactsQuery, type FactView, type PersonalFacts } from '@autoapply/shared';
import { loadFactLikes } from '@autoapply/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';
import { toFactView, toRevisionView } from './views.js';

const include = { sources: true, conflicts: { select: { id: true, status: true } } } satisfies Prisma.FactInclude;
const json = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class FactsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async list(q: FactsQuery): Promise<FactView[]> {
    const where: Prisma.FactWhereInput = {
      status: q.status,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.origin ? { sources: { some: { origin: q.origin } } } : {}),
      ...(q.verified ? { verifiedByUser: q.verified === 'true' } : {}),
      ...(q.conflict ? { hasOpenConflict: q.conflict === 'true' } : {}),
    };
    const rows = await this.db.fact.findMany({ where, include, orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
    const needle = q.q?.toLowerCase();
    return rows
      .filter((f) => !needle || f.key.includes(needle) || JSON.stringify(f.value).toLowerCase().includes(needle))
      .map(toFactView);
  }

  async get(id: string) {
    const f = await this.db.fact.findUnique({ where: { id }, include: { ...include, revisions: { orderBy: { createdAt: 'desc' } } } });
    if (!f) throw new ApiError(404, 'not_found', 'fato não encontrado');
    return { ...toFactView(f), revisions: f.revisions.map(toRevisionView) };
  }

  private parseValue(kind: FactKind, value: unknown) {
    const r = FactValueSchemas[kind].safeParse(value);
    if (!r.success) throw new ApiError(400, 'invalid_value', 'valor inválido para este tipo de fato', r.error.issues);
    return r.data as Record<string, unknown>;
  }

  /** User-entered fact (verified, origin user). */
  async create(kind: FactKind, value: unknown): Promise<FactView> {
    const v = this.parseValue(kind, value);
    const key = factKey(kind, v);
    if (await this.db.fact.findUnique({ where: { kind_key: { kind, key } } })) {
      throw new ApiError(409, 'key_exists', 'já existe um fato equivalente');
    }
    const f = await this.db.fact.create({
      data: {
        kind,
        key,
        value: json(v),
        verifiedByUser: true,
        sources: { create: { origin: 'user', ref: 'user:manual', rawValue: json(v) } },
        revisions: { create: { action: 'created', after: json(v), actor: 'user' } },
      },
      include,
    });
    return toFactView(f);
  }

  async patch(id: string, body: { value?: unknown; verified?: boolean }): Promise<FactView> {
    const f = await this.db.fact.findUnique({ where: { id } });
    if (!f) throw new ApiError(404, 'not_found', 'fato não encontrado');
    await this.db.$transaction(async (tx) => {
      if (body.value !== undefined) {
        const v = this.parseValue(f.kind, body.value);
        const key = f.kind === 'personal' ? f.key : factKey(f.kind, v);
        if (key !== f.key && (await tx.fact.findUnique({ where: { kind_key: { kind: f.kind, key } } }))) {
          throw new ApiError(409, 'key_exists', 'já existe um fato equivalente');
        }
        await tx.fact.update({ where: { id }, data: { value: json(v), key } });
        await tx.factRevision.create({ data: { factId: id, action: 'edited', before: json(f.value), after: json(v), actor: 'user' } });
      }
      if (body.verified !== undefined && body.verified !== f.verifiedByUser) {
        await tx.fact.update({ where: { id }, data: { verifiedByUser: body.verified } });
        await tx.factRevision.create({ data: { factId: id, action: body.verified ? 'verified' : 'unverified', actor: 'user' } });
      }
    });
    return toFactView(await this.db.fact.findUniqueOrThrow({ where: { id }, include }));
  }

  /** FR-004/FR-005: bulk verify/unverify/archive/restore; archive never deletes. */
  async bulk(ids: string[], action: 'verify' | 'unverify' | 'archive' | 'restore') {
    const data: Prisma.FactUpdateInput =
      action === 'verify' ? { verifiedByUser: true }
      : action === 'unverify' ? { verifiedByUser: false }
      : action === 'archive' ? { status: 'archived' }
      : { status: 'active' };
    const revision = action === 'verify' ? 'verified' : action === 'unverify' ? 'unverified' : action === 'archive' ? 'archived' : 'restored';
    const updated = await this.db.$transaction(async (tx) => {
      const rows = await tx.fact.findMany({ where: { id: { in: ids } }, select: { id: true } });
      for (const { id } of rows) {
        await tx.fact.update({ where: { id }, data });
        await tx.factRevision.create({ data: { factId: id, action: revision, actor: 'user' } });
      }
      return rows.length;
    });
    return { updated };
  }

  async getPersonal(): Promise<PersonalFacts> {
    const facts = await this.db.fact.findMany({ where: { kind: 'personal', status: 'active' }, select: { key: true, value: true } });
    return factsToPersonal(facts);
  }

  /** Each field ↔ one verified `personal:*` fact; changed fields keep the old value in revisions. */
  async putPersonal(input: PersonalFacts): Promise<PersonalFacts> {
    const existing = await loadFactLikes(this.db, { kind: 'personal' });
    const merge = mergeCandidates(existing, personalToCandidates(input), { trusted: true });
    await applyMerge(this.db, merge, { actor: 'user', verify: true, note: 'personal form' });
    return this.getPersonal();
  }
}
