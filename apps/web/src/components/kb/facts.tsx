"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { FactKind, FactView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, facts, type BulkAction, type FactsFilter } from "@/lib/api";
import {
  KIND_LABEL,
  ORIGIN_LABEL,
  checkboxClass,
  fmtDateTime,
  fmtDay,
  githubEvidence,
  githubRefUrl,
  nativeSelectClass,
  originLabel,
  summarizeValue,
} from "./format";
import { useLoad } from "./use-load";

const FILTER_KEYS = ["kind", "origin", "verified", "conflict", "status", "q"] as const;

function filterFromParams(sp: URLSearchParams): FactsFilter {
  const f: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) f[k] = v;
  }
  return f as FactsFilter;
}

export function FactsView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = filterFromParams(new URLSearchParams(searchParams.toString()));
  const filterKey = JSON.stringify(filter);
  const { data, loading, reload } = useLoad(() => facts.list(filter), filterKey);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState(filter.q ?? "");
  const [busy, setBusy] = useState(false);

  function setFilter(patch: Partial<Record<(typeof FILTER_KEYS)[number], string | undefined>>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    setSelected(new Set());
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  }

  async function bulk(action: BulkAction) {
    if (!selected.size) return;
    setBusy(true);
    try {
      const r = await facts.bulk([...selected], action);
      toast.success(`${r.updated} fato(s) atualizado(s)`);
      setSelected(new Set());
      await reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <select className={nativeSelectClass} value={filter.kind ?? ""} onChange={(e) => setFilter({ kind: e.target.value })} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {(Object.keys(KIND_LABEL) as FactKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={nativeSelectClass} value={filter.origin ?? ""} onChange={(e) => setFilter({ origin: e.target.value })} aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(ORIGIN_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className={nativeSelectClass} value={filter.verified ?? ""} onChange={(e) => setFilter({ verified: e.target.value })} aria-label="Verificação">
          <option value="">Verificados e não</option>
          <option value="true">Verificados</option>
          <option value="false">Não verificados</option>
        </select>
        <select className={nativeSelectClass} value={filter.conflict ?? ""} onChange={(e) => setFilter({ conflict: e.target.value })} aria-label="Conflito">
          <option value="">Com e sem conflito</option>
          <option value="true">Em conflito</option>
          <option value="false">Sem conflito</option>
        </select>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={filter.status === "archived"}
            onChange={(e) => setFilter({ status: e.target.checked ? "archived" : undefined })}
          />
          Arquivados
        </label>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ q });
          }}
        >
          <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{selected.size} selecionado(s)</span>
        <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("verify")}>
          Verificar
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("unverify")}>
          Desverificar
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("archive")}>
          Arquivar
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("restore")}>
          Restaurar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {!data ? (
            <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Não foi possível carregar."}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum fato com esses filtros.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Fontes</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => (
                  <FactRow
                    key={f.id}
                    fact={f}
                    selected={selected.has(f.id)}
                    open={openId === f.id}
                    onSelect={(on) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (on) n.add(f.id);
                        else n.delete(f.id);
                        return n;
                      })
                    }
                    onOpen={() => setOpenId(openId === f.id ? null : f.id)}
                    onChanged={() => reload(true)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {openId && <FactDetailPanel key={openId} id={openId} onClose={() => setOpenId(null)} />}
      </div>
    </div>
  );
}

function FactRow({
  fact: f,
  selected,
  open,
  onSelect,
  onOpen,
  onChanged,
}: {
  fact: FactView;
  selected: boolean;
  open: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const ev = f.kind === "skill" ? githubEvidence(f.value) : undefined;
  const origins = [...new Set(f.sources.map((s) => s.origin))];

  async function rename() {
    const value = { ...(f.value as Record<string, unknown>), name: name.trim() };
    try {
      await facts.patch(f.id, { value });
      toast.success("Skill renomeada");
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <TableRow data-state={open ? "selected" : undefined} className="cursor-pointer" onClick={onOpen}>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className={checkboxClass} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </TableCell>
      <TableCell>{KIND_LABEL[f.kind]}</TableCell>
      <TableCell className="whitespace-normal">
        {editing ? (
          <form
            className="flex gap-2"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 w-48" autoFocus />
            <Button size="sm" type="submit" disabled={!name.trim()}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </form>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span>{summarizeValue(f.kind, f.value)}</span>
              {f.kind === "skill" && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setName(String((f.value as Record<string, unknown>).name ?? ""));
                    setEditing(true);
                  }}
                >
                  renomear
                </Button>
              )}
            </div>
            {ev && (
              <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                GitHub: {ev.repoCount} repos{ev.lastActivity ? `, último em ${fmtDay(ev.lastActivity)}` : ""}
                {ev.forkOnly && <Badge variant="outline">só forks</Badge>}
                {ev.archivedOnly && <Badge variant="outline">só arquivados</Badge>}
              </div>
            )}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {origins.map((o) => (
            <Badge key={o} variant="secondary">
              {originLabel(o)}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {f.verifiedByUser ? <Badge>verificado</Badge> : <Badge variant="outline">não verificado</Badge>}
          {f.hasOpenConflict && <Badge variant="destructive">conflito</Badge>}
          {f.status === "archived" && <Badge variant="outline">arquivado</Badge>}
          {f.missingFrom.map((o) => (
            <Badge key={o} variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              sumiu de {originLabel(o)}
            </Badge>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

const ACTOR_LABEL = { user: "você", import: "importação", sync: "sincronização" } as const;
const ACTION_LABEL: Record<string, string> = {
  created: "criado",
  edited: "editado",
  verified: "verificado",
  source_added: "fonte adicionada",
  conflict_resolved: "conflito resolvido",
};
const VALUE_ACTIONS = new Set(["created", "edited", "conflict_resolved"]);

function revisionValue(kind: FactKind, action: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  return VALUE_ACTIONS.has(action) ? summarizeValue(kind, v) : JSON.stringify(v);
}

function FactDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useLoad(() => facts.get(id), id);
  return (
    <aside className="bg-card space-y-4 self-start rounded-xl p-4 text-sm ring-1 ring-foreground/10 lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{data ? summarizeValue(data.kind, data.value) : "Carregando…"}</h3>
        <Button size="xs" variant="ghost" onClick={onClose}>
          fechar
        </Button>
      </div>
      {data && (
        <>
          <p className="text-muted-foreground font-mono text-xs break-all">{data.key}</p>
          {data.openConflictId && (
            <Link href="/conhecimento/conflitos" className="text-destructive hover:underline">
              Este fato tem um conflito aberto →
            </Link>
          )}
          <section className="space-y-2">
            <h4 className="font-medium">Fontes</h4>
            {data.sources.map((s) => {
              const url = s.origin === "github" ? githubRefUrl(s.ref) : null;
              return (
                <div key={s.id} className="space-y-1 rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{originLabel(s.origin)}</Badge>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="text-primary font-mono text-xs break-all hover:underline">
                        {s.ref}
                      </a>
                    ) : (
                      <span className="font-mono text-xs break-all">{s.ref}</span>
                    )}
                  </div>
                  {s.snippet && <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">“{s.snippet}”</p>}
                  <p className="text-muted-foreground text-xs">
                    importado {fmtDateTime(s.importedAt)} · visto {fmtDateTime(s.lastSeenAt)}
                  </p>
                </div>
              );
            })}
          </section>
          <section className="space-y-2">
            <h4 className="font-medium">Histórico</h4>
            {data.revisions.length === 0 && <p className="text-muted-foreground text-xs">Sem revisões.</p>}
            <ol className="space-y-2">
              {data.revisions.map((r) => (
                <li key={r.id} className="border-l-2 pl-2 text-xs">
                  <div>
                    <strong>{ACTION_LABEL[r.action] ?? r.action}</strong> por {ACTOR_LABEL[r.actor]} · {fmtDateTime(r.createdAt)}
                  </div>
                  {r.note && <div className="text-muted-foreground">{r.note}</div>}
                  {revisionValue(data.kind, r.action, r.before) && (
                    <div className="text-muted-foreground line-through">{revisionValue(data.kind, r.action, r.before)}</div>
                  )}
                  {revisionValue(data.kind, r.action, r.after) && <div>{revisionValue(data.kind, r.action, r.after)}</div>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </aside>
  );
}
