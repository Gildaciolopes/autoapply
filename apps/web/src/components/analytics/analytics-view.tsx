"use client";

import { useState } from "react";
import type { FunnelSplit, FunnelStage, FunnelView, ReplyType } from "@autoapply/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analytics } from "@/lib/api";
import { fmtDay, nativeSelectClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { REPLY_TYPE_LABELS } from "../replies/format";

/** Mirrors FUNNEL_STAGES in @autoapply/shared (value import would pull zod into the client bundle). */
const FUNNEL_STAGES: readonly FunnelStage[] = ["found", "above_threshold", "prepared", "approved", "submitted", "replied", "interview"];

const WEEKS = [4, 8, 12, 26, 52] as const;

type SplitTab = "total" | FunnelSplit;
const SPLITS: [SplitTab, string][] = [
  ["total", "Total"],
  ["source", "Fonte"],
  ["platform", "Plataforma"],
  ["week", "Semana"],
];

function stageLabel(stage: FunnelStage, threshold: number): string {
  switch (stage) {
    case "found":
      return "Encontradas";
    case "above_threshold":
      return `Acima do limite (≥ ${threshold})`;
    case "prepared":
      return "Preparadas";
    case "approved":
      return "Aprovadas";
    case "submitted":
      return "Enviadas";
    case "replied":
      return "Respondidas";
    case "interview":
      return "Entrevistas";
  }
}

const fmtRate = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** `/analises` (F7 T010): cohort funnel of the jobs found in the period, optionally split. */
export function AnalyticsView() {
  const [weeks, setWeeks] = useState<number>(8);
  const [split, setSplit] = useState<SplitTab>("total");
  const { data, loading } = useLoad(() => analytics.funnel(weeks, split === "total" ? undefined : split), `${weeks}:${split}`);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Funil das vagas encontradas no período: cada etapa mostra quantas chegaram lá e a conversão da etapa anterior.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Período
          <select aria-label="Período" className={nativeSelectClass} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {WEEKS.map((w) => (
              <option key={w} value={w}>
                {w} semanas
              </option>
            ))}
          </select>
        </label>
        <Tabs value={split} onValueChange={(v) => setSplit(v as SplitTab)}>
          <TabsList>
            {SPLITS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {data && (
          <span className="text-muted-foreground text-xs">
            {fmtDay(data.from)} – {fmtDay(data.to)}
          </span>
        )}
      </div>

      {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && data.totals.found === 0 && (
        <p className="text-muted-foreground text-sm">Nenhuma vaga encontrada neste período. Rode uma busca em Vagas ou aumente o período.</p>
      )}
      {data && data.totals.found > 0 && (
        <>
          <FunnelBars view={data} />
          {data.split && data.buckets.length > 0 && <SplitTable view={data} />}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Taxa de resposta" value={fmtRate(data.responseRate)} hint="respondidas ÷ enviadas" />
            <StatCard
              title="Mediana até resposta"
              value={data.medianDaysToReply === null ? "—" : `${data.medianDaysToReply.toLocaleString("pt-BR")} dias`}
              hint="do envio à primeira resposta"
            />
            <ReplyTypesCard types={data.replyTypes} />
            <MissingSkillsCard skills={data.missingSkills} />
          </div>
        </>
      )}
    </div>
  );
}

function FunnelBars({ view }: { view: FunnelView }) {
  const max = view.totals.found;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Funil</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {FUNNEL_STAGES.map((stage) => {
          const count = view.totals[stage];
          const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 1 : 0) : 0;
          return (
            <div key={stage} className="grid grid-cols-[minmax(9rem,14rem)_1fr_auto] items-center gap-3 text-sm">
              <span>{stageLabel(stage, view.threshold)}</span>
              <div className="bg-muted h-5 overflow-hidden rounded">
                <div className="bg-primary/70 h-full rounded" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-28 text-right tabular-nums">
                <strong>{count}</strong>
                {stage !== "found" && <span className="text-muted-foreground"> · {fmtRate(view.rates[stage])}</span>}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SplitTable({ view }: { view: FunnelView }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{SPLITS.find(([k]) => k === view.split)?.[1]}</TableHead>
            {FUNNEL_STAGES.map((stage) => (
              <TableHead key={stage} className="text-right whitespace-normal">
                {stageLabel(stage, view.threshold)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.buckets.map((b) => (
            <TableRow key={b.key}>
              <TableCell className="font-medium">{b.label}</TableCell>
              {FUNNEL_STAGES.map((stage) => (
                <TableCell key={stage} className="text-right align-top tabular-nums">
                  <div>{b.counts[stage]}</div>
                  {stage !== "found" && <div className="text-muted-foreground text-xs">{fmtRate(b.rates[stage])}</div>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ReplyTypesCard({ types }: { types: FunnelView["replyTypes"] }) {
  const entries = (Object.entries(types) as [ReplyType, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">Tipos de resposta</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma resposta registrada.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {entries.map(([type, n]) => (
              <li key={type} className="flex justify-between gap-2">
                <span>{REPLY_TYPE_LABELS[type] ?? type}</span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MissingSkillsCard({ skills }: { skills: FunnelView["missingSkills"] }) {
  const top = skills.slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">Skills que mais faltam</CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma skill faltando.</p>
        ) : (
          <ol className="space-y-0.5 text-sm">
            {top.map((s) => (
              <li key={s.skill} className="flex justify-between gap-2">
                <span>{s.skill}</span>
                <span className="tabular-nums">{s.count}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
