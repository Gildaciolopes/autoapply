"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { DiscoveryRunView, JobCard, JobSourceType, WorkMode } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiRequestError, discovery, errorMessage, jobs, preferences, type JobsFilter } from "@/lib/api";
import { checkboxClass, fmtDateTime, nativeSelectClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import {
  FILTER_REASON_LABEL,
  SENIORITY_LABEL,
  SOURCE_LABEL,
  WORK_MODE_LABEL,
  fmtAge,
  fmtLocation,
  fmtSalary,
  label,
  scoreClass,
} from "./format";
import { JobActions } from "./job-actions";

const PAGE_SIZE = 30;
const POLL_MS = 3000;
const FLAG_KEYS = ["judged", "interesting", "showFiltered", "showHidden"] as const;
type FilterKey = "minScore" | "source" | "workMode" | (typeof FLAG_KEYS)[number];

function filterFromParams(sp: URLSearchParams): JobsFilter {
  const f: JobsFilter = {};
  const min = Number(sp.get("minScore"));
  if (sp.get("minScore") && Number.isFinite(min) && min > 0) f.minScore = Math.min(100, Math.trunc(min));
  const source = sp.get("source");
  if (source && source in SOURCE_LABEL) f.source = source as JobSourceType;
  const mode = sp.get("workMode");
  if (mode && mode in WORK_MODE_LABEL) f.workMode = mode as WorkMode;
  for (const k of FLAG_KEYS) if (sp.get(k) === "true") f[k] = "true";
  return f;
}

export function FeedView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = filterFromParams(new URLSearchParams(searchParams.toString()));
  const filterKey = JSON.stringify(filter);

  const feed = useLoad(() => jobs.list({ ...filter, limit: PAGE_SIZE }), filterKey);
  const prefs = useLoad(() => preferences.get());
  const [loadingMore, setLoadingMore] = useState(false);
  const [starting, setStarting] = useState(false);

  // Run tracking: poll the active run (or the latest one) every 3 s while it is running.
  const activeRunId = useRef<string | null>(null);
  const wasRunning = useRef(false);
  const lastRun = useLoad<DiscoveryRunView | null>(
    async () => {
      const run = activeRunId.current ? await discovery.get(activeRunId.current) : ((await discovery.runs(1))[0] ?? null);
      const running = run?.status === "running";
      if (wasRunning.current && !running && run) {
        activeRunId.current = null;
        if (run.status === "done") toast.success(run.trigger === "rescore" ? "Reavaliação concluída" : "Busca concluída");
        else toast.error(run.trigger === "rescore" ? "Reavaliação falhou" : "Busca falhou");
        void feed.reload(true);
      }
      wasRunning.current = running;
      return run;
    },
    "",
    { pollMs: POLL_MS, shouldPoll: (r) => r?.status === "running" },
  );
  const running = lastRun.data?.status === "running";

  function setFilter(patch: Partial<Record<FilterKey, string | undefined>>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  }

  // Score slider: local value, committed to the URL after a short pause.
  const [minScore, setMinScore] = useState(String(filter.minScore ?? 0));
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onMinScore(v: string) {
    setMinScore(v);
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    scoreTimer.current = setTimeout(() => {
      const n = Math.min(100, Math.max(0, Math.trunc(Number(v) || 0)));
      setFilter({ minScore: n > 0 ? String(n) : undefined });
    }, 400);
  }

  async function trigger(kind: "run" | "rescore") {
    if (kind === "rescore") {
      const n = prefs.data?.judgeTopN ?? 20;
      if (!window.confirm(`Recalcula a similaridade de todas as vagas e usa o LLM local nas ${n} melhores — pode levar alguns minutos.`)) return;
    }
    setStarting(true);
    try {
      const { runId } = kind === "run" ? await discovery.start() : await discovery.rescore(true);
      activeRunId.current = runId;
      toast.info(kind === "run" ? "Busca iniciada" : "Reavaliação iniciada");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "run_in_progress") {
        const id = (err.details as { runId?: string } | undefined)?.runId;
        if (id) activeRunId.current = id;
        toast.warning("Já existe uma busca em andamento — acompanhando o progresso.");
      } else if (err instanceof ApiRequestError && err.code === "no_preferences") {
        toast.error("Defina ao menos um cargo nas Preferências antes de buscar.", {
          action: { label: "Preferências", onClick: () => router.push("/vagas/preferencias") },
        });
        return;
      } else {
        toast.error(errorMessage(err));
        return;
      }
    } finally {
      setStarting(false);
    }
    wasRunning.current = true;
    await lastRun.reload(true);
  }

  async function loadMore() {
    const cursor = feed.data?.nextCursor;
    if (cursor == null) return;
    setLoadingMore(true);
    try {
      const r = await jobs.list({ ...filter, limit: PAGE_SIZE, cursor });
      feed.setData((prev) => ({ items: [...(prev?.items ?? []), ...r.items], nextCursor: r.nextCursor }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function updateJob(id: string, patch: Partial<JobCard>) {
    feed.setData((prev) => {
      if (!prev) return prev;
      const items = prev.items
        .map((j) => (j.id === id ? { ...j, ...patch } : j))
        .filter((j) => filter.showHidden === "true" || !j.hidden);
      return { ...prev, items };
    });
  }

  const items = feed.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={starting || running} onClick={() => void trigger("run")}>
          {running ? "Buscando…" : "Buscar agora"}
        </Button>
        <Button variant="outline" disabled={starting || running} onClick={() => void trigger("rescore")}>
          Reavaliar
        </Button>
        <span className="text-muted-foreground ml-auto text-sm">
          {feed.loading ? "Carregando…" : `${items.length}${feed.data?.nextCursor != null ? "+" : ""} vaga(s)`}
        </span>
      </div>

      <RunSummary run={lastRun.data ?? null} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
        <label className="flex items-center gap-2">
          Score mín.
          <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => onMinScore(e.target.value)} className="accent-primary w-28" />
          <Input type="number" min={0} max={100} className="h-8 w-16" value={minScore} onChange={(e) => onMinScore(e.target.value)} />
        </label>
        <select
          aria-label="Fonte"
          className={nativeSelectClass}
          value={filter.source ?? ""}
          onChange={(e) => setFilter({ source: e.target.value || undefined })}
        >
          <option value="">Todas as fontes</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Modalidade"
          className={nativeSelectClass}
          value={filter.workMode ?? ""}
          onChange={(e) => setFilter({ workMode: e.target.value || undefined })}
        >
          <option value="">Qualquer modalidade</option>
          {Object.entries(WORK_MODE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {(
          [
            ["judged", "só avaliadas"],
            ["interesting", "só interessantes"],
            ["showFiltered", "mostrar filtradas"],
            ["showHidden", "mostrar ocultas"],
          ] as const
        ).map(([k, text]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={filter[k] === "true"}
              onChange={(e) => setFilter({ [k]: e.target.checked ? "true" : undefined })}
            />
            {text}
          </label>
        ))}
      </div>

      {!feed.loading && items.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nenhuma vaga com esses filtros. Ajuste os filtros, clique em &quot;Buscar agora&quot; ou revise as{" "}
          <Link href="/vagas/preferencias" className="underline">
            preferências
          </Link>
          .
        </p>
      )}

      <div className="space-y-3">
        {items.map((j) => (
          <JobCardView key={j.id} job={j} onChange={(p) => updateJob(j.id, p)} onBlocked={() => void feed.reload(true)} />
        ))}
      </div>

      {feed.data?.nextCursor != null && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}

const TRIGGER_LABEL: Record<DiscoveryRunView["trigger"], string> = { manual: "manual", schedule: "agendada", rescore: "reavaliação" };
const RUN_STATUS_LABEL: Record<DiscoveryRunView["status"], string> = { running: "em andamento", done: "concluída", failed: "falhou" };

function RunSummary({ run }: { run: DiscoveryRunView | null }) {
  if (!run) return <p className="text-muted-foreground text-sm">Nenhuma busca realizada ainda.</p>;
  const outcomes = Object.entries(run.outcomes);
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Última busca</span>
        <Badge variant={run.status === "failed" ? "destructive" : run.status === "running" ? "secondary" : "outline"}>
          {RUN_STATUS_LABEL[run.status]}
        </Badge>
        <span className="text-muted-foreground">
          {TRIGGER_LABEL[run.trigger]} · {fmtDateTime(run.startedAt)}
          {run.judged > 0 && ` · ${run.judged} avaliada(s) pelo LLM`}
        </span>
      </div>
      {outcomes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {outcomes.map(([src, o]) => (
            <Badge
              key={src}
              variant={o.status === "failed" ? "destructive" : o.status === "skipped" ? "secondary" : "outline"}
              title={o.error}
              className="h-auto whitespace-normal"
            >
              {label(SOURCE_LABEL, src)}:{" "}
              {o.status === "failed"
                ? `erro${o.error ? ` — ${o.error}` : ""}`
                : o.status === "skipped"
                  ? `pulada${o.error ? ` — ${o.error}` : ""}`
                  : `${o.found} encontradas · ${o.new} novas · ${o.duplicates} duplicadas · ${o.filtered} filtradas`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const MAX_MISSING = 6;

export function ScoreBadge({ job }: { job: JobCard }) {
  const s = job.score;
  if (!s) return <Badge variant="secondary">sem score</Badge>;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`inline-flex size-12 items-center justify-center rounded-full text-lg font-semibold ${scoreClass(s.score)}`}>{s.score}</span>
      {!s.judged && <span className="text-muted-foreground max-w-20 text-center text-[10px] leading-tight">não avaliado em detalhe</span>}
    </div>
  );
}

function JobCardView({ job, onChange, onBlocked }: { job: JobCard; onChange: (p: Partial<JobCard>) => void; onBlocked: () => void }) {
  const s = job.score;
  const missing = s?.missing ?? [];
  return (
    <Card className={job.hidden ? "opacity-60" : undefined}>
      <CardContent className="flex gap-4">
        <ScoreBadge job={job} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/vagas/${job.id}`} className="font-semibold hover:underline">
                {job.title}
              </Link>
              {job.possiblyClosed && <Badge variant="secondary">possivelmente encerrada</Badge>}
              {s && !s.passed && s.filterReason && (
                <Badge variant="destructive">filtrada: {FILTER_REASON_LABEL[s.filterReason]}</Badge>
              )}
              {job.hidden && <Badge variant="outline">oculta</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                job.company ?? "empresa não informada",
                fmtLocation(job),
                job.workMode ? label(WORK_MODE_LABEL, job.workMode) : null,
                job.seniority ? label(SENIORITY_LABEL, job.seniority) : null,
                fmtSalary(job),
                fmtAge(job.postedAt ?? job.firstSeenAt),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {job.origins.map((o) => (
              <Badge key={`${o.source}:${o.url}`} variant="outline">
                {label(SOURCE_LABEL, o.source)}
              </Badge>
            ))}
          </div>
          {s && (s.matched.length > 0 || missing.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {s.matched.map((m) => (
                <Badge key={m.skill} className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">
                  ✓ {m.skill}
                </Badge>
              ))}
              {missing.slice(0, MAX_MISSING).map((m) => (
                <Badge key={m} variant="secondary" className="text-muted-foreground">
                  {m}
                </Badge>
              ))}
              {missing.length > MAX_MISSING && <Badge variant="secondary">+{missing.length - MAX_MISSING}</Badge>}
            </div>
          )}
          {s?.reasons && <p className="line-clamp-2 text-sm">{s.reasons}</p>}
          <JobActions job={job} onChange={onChange} onBlocked={onBlocked} />
        </div>
      </CardContent>
    </Card>
  );
}
