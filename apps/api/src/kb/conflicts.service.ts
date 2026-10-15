import { Injectable } from '@nestjs/common';
import { refreshConflictFlag, type Prisma } from '@autoapply/db';
import { sameValue } from '@autoapply/kb';
import { FactValueSchemas, type ConflictCandidate, type ConflictView, type ResolveConflictBody } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';
import { toConflictView } from './views.js';

const json = (v: unknown) => (v ?? null) as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;

async function upsertSource(tx: Tx, factId: string, c: ConflictCandidate) {
  await tx.factSource.upsert({
    where: { factId_origin_ref: { factId, origin: c.origin, ref: c.ref } },
    create: { factId, origin: c.origin, ref: c.ref, rawValue: json(c.value) },
    update: { rawValue: json(c.value), lastSeenAt: new Date() },
  });
}

@Injectable()
export class ConflictsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status: 'open' | 'resolved' = 'open'): Promise<ConflictView[]> {
    const rows = await this.prisma.client.factConflict.findMany({
      where: { status },
      include: { fact: { select: { kind: true, key: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toConflictView);
  }

  /**
   * FR-019: resolve by choose / edit / split (value_mismatch) or merge / keep_separate
   * (possible_duplicate). Resolution verifies the outcome (it is a user decision) and keeps
   * the rejected value in FactRevision.before.
   */
  async resolve(id: string, body: ResolveConflictBody): Promise<{ factIds: string[] }> {
    return this.prisma.client.$transaction(async (tx) => {
      const c = await tx.factConflict.findUnique({ where: { id }, include: { fact: true } });
      if (!c) throw new ApiError(404, 'not_found', 'conflito não encontrado');
      if (c.status !== 'open') throw new ApiError(409, 'already_resolved', 'conflito já resolvido');
      const candidates = c.candidates as ConflictCandidate[];
      const fact = c.fact;
      const allowed =
        c.type === 'value_mismatch' ? ['choose', 'edit', 'split'] : ['merge', 'keep_separate'];
      if (!allowed.includes(body.strategy)) {
        throw new ApiError(400, 'invalid_strategy', `estratégia "${body.strategy}" não se aplica a ${c.type}`);
      }
      const factIds = [fact.id];
      /** Candidates the user turned down; remembered so the next sync does not re-open the conflict. */
      let rejected: ConflictCandidate[] = [];
      const revision = (factId: string, before: unknown, after: unknown, note: string) =>
        tx.factRevision.create({ data: { factId, action: 'conflict_resolved', before: json(before), after: json(after), actor: 'user', note } });

      switch (body.strategy) {
        case 'choose': {
          const chosen = candidates[body.chosenIndex];
          if (!chosen) throw new ApiError(400, 'invalid_index', 'opção inexistente');
          await tx.fact.update({ where: { id: fact.id }, data: { value: json(chosen.value), verifiedByUser: true } });
          await upsertSource(tx, fact.id, chosen);
          await revision(fact.id, fact.value, chosen.value, `chose ${chosen.origin}`);
          rejected = candidates.filter((x) => !sameValue(fact.kind, x.value, chosen.value));
          break;
        }
        case 'edit': {
          const parsed = FactValueSchemas[fact.kind].safeParse(body.value);
          if (!parsed.success) throw new ApiError(400, 'invalid_value', 'valor inválido', parsed.error.issues);
          await tx.fact.update({ where: { id: fact.id }, data: { value: json(parsed.data), verifiedByUser: true } });
          await revision(fact.id, fact.value, parsed.data, 'edited');
          rejected = candidates.filter((x) => !sameValue(fact.kind, x.value, parsed.data));
          break;
        }
        case 'split': {
          // Both values are real, distinct items: keep the stored one, create the others.
          await tx.fact.update({ where: { id: fact.id }, data: { verifiedByUser: true } });
          for (const cand of candidates.slice(1)) {
            let n = 2;
            while (await tx.fact.findUnique({ where: { kind_key: { kind: fact.kind, key: `${fact.key}:${n}` } } })) n++;
            const nf = await tx.fact.create({
              data: {
                kind: fact.kind,
                key: `${fact.key}:${n}`,
                value: json(cand.value),
                verifiedByUser: true,
                sources: { create: { origin: cand.origin, ref: cand.ref, rawValue: json(cand.value) } },
                revisions: { create: { action: 'created', after: json(cand.value), actor: 'user', note: `split from ${fact.key}` } },
              },
            });
            factIds.push(nf.id);
          }
          await revision(fact.id, null, fact.value, 'split');
          break;
        }
        case 'merge': {
          // Duplicate: move the new fact's sources into the existing one, archive the new one.
          const target = c.otherFactId!;
          const sources = await tx.factSource.findMany({ where: { factId: fact.id } });
          for (const s of sources) {
            await tx.factSource.upsert({
              where: { factId_origin_ref: { factId: target, origin: s.origin, ref: s.ref } },
              create: { factId: target, origin: s.origin, ref: s.ref, rawValue: json(s.rawValue), snippet: s.snippet },
              update: { lastSeenAt: new Date() },
            });
          }
          await tx.fact.update({ where: { id: fact.id }, data: { status: 'archived' } });
          await revision(fact.id, fact.value, null, `merged into ${target}`);
          await revision(target, null, null, `merged ${fact.id}`);
          factIds.push(target);
          break;
        }
        case 'keep_separate':
          await revision(fact.id, null, fact.value, 'kept separate');
          break;
      }

      await tx.factConflict.update({
        where: { id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolution: json({ ...body, rejected: rejected.map((r) => ({ origin: r.origin, ref: r.ref, value: r.value })) }),
        },
      });
      for (const fid of factIds) await refreshConflictFlag(tx, fid);
      return { factIds };
    });
  }
}
