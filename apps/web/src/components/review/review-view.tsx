"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ReviewGroup } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { night, preferences, review } from "@/lib/api";
import { refusedLabel } from "../apply/format";
import { nativeSelectClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { STATUS_LABEL, TRIGGER_LABEL, fmtNightDate } from "../night/format";
import { ApproveBar } from "./approve-bar";
import { ReviewRow } from "./review-row";

const ALL = "all";

const GROUPS: [ReviewGroup, string][] = [
  ["ready", "Prontas"],
  ["needs_input", "Precisam de resposta"],
  ["failed", "Falharam"],
  ["submit_uncertain", "Envio incerto"],
  ["waiting_limit", "Aguardando limite"],
  ["approved", "Aprovadas"],
];

/** `/revisao` (F6 T020): the morning batch review of what the night prepared. */
export function ReviewView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: runs } = useLoad(() => night.runs());
  const { data: prefs } = useLoad(() => preferences.get());

  const param = params.get("run");
  // Default: ?run= param, else the latest run, else every run.
  const runId = param ?? (runs ? (runs[0]?.id ?? ALL) : undefined);

  const { data: queue, reload } = useLoad(
    () => (runId === undefined ? Promise.resolve(undefined) : review.queue(runId === ALL ? undefined : runId)),
    runId ?? "",
    { pollMs: 10_000, shouldPoll: (q) => (q?.counts.approved ?? 0) > 0 || q?.run?.status === "running" },
  );
  const [group, setGroup] = useState<ReviewGroup>("ready");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<{ id: string; title: string; code: string }[]>([]);

  const dryRun = prefs?.mode === "dry_run";
  const items = queue?.groups[group] ?? [];
  const readyItems = queue?.groups.ready ?? [];
  const selectedItems = group === "ready" ? readyItems.filter((i) => selected.has(i.applicationId)) : [];

  function changeRun(v: string) {
    setSelected(new Set());
    router.replace(`${pathname}?run=${encodeURIComponent(v)}`);
  }

  function changeGroup(g: ReviewGroup) {
    setGroup(g);
    setSelected(new Set());
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const refresh = () => void reload(true);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        O que a noite preparou. Nada é enviado sem a sua aprovação: revise, responda o que faltou, rejeite o que não quer e aprove em lote.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="reviewRun" className="font-medium">
          Execução
        </label>
        <select
          id="reviewRun"
          className={nativeSelectClass}
          value={runId ?? ""}
          disabled={!runs}
          onChange={(e) => changeRun(e.target.value)}
        >
          <option value={ALL}>Todas</option>
          {runs?.map((r) => (
            <option key={r.id} value={r.id}>
              {fmtNightDate(r.nightDate)} · {TRIGGER_LABEL[r.trigger]} · {STATUS_LABEL[r.status]}
            </option>
          ))}
          {param && param !== ALL && runs && !runs.some((r) => r.id === param) && <option value={param}>{param}</option>}
        </select>
        <Button size="sm" variant="ghost" onClick={refresh}>
          Atualizar
        </Button>
      </div>

      <Tabs value={group} onValueChange={(v) => changeGroup(v as ReviewGroup)}>
        <TabsList className="h-auto flex-wrap">
          {GROUPS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label} ({queue?.counts[value] ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {group === "ready" && readyItems.length > 0 && (
        <ApproveBar
          items={selectedItems}
          allIds={readyItems.map((i) => i.applicationId)}
          dryRun={dryRun}
          onSelectAll={(ids) => setSelected(new Set(ids))}
          onDone={(res) => {
            const titles = new Map(readyItems.map((i) => [i.applicationId, i.title]));
            setRefused(res.refused.map((r) => ({ ...r, title: titles.get(r.id) ?? r.id })));
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {refused.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center gap-2">
            <p className="font-medium">Não aprovadas ({refused.length})</p>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRefused([])}>
              Fechar
            </Button>
          </div>
          <ul className="space-y-0.5">
            {refused.map((r) => (
              <li key={r.id}>
                {r.title} — {refusedLabel(r.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!queue && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {queue && items.length === 0 && <p className="text-muted-foreground text-sm">Nada aqui.</p>}
      {items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {items.map((i) => (
            <ReviewRow
              key={i.applicationId}
              item={i}
              selectable={group === "ready"}
              selected={selected.has(i.applicationId)}
              onSelect={(on) => toggle(i.applicationId, on)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
