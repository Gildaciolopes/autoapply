"use client";

import Link from "next/link";
import type { NightCounters, NightRunListItem, NightRunView, WindowView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtPercent } from "../apply/format";
import { LiveLog } from "./live-log";
import { PHASE_LABEL, REPORT_LABEL, STATUS_CLASS, STATUS_LABEL, TRIGGER_LABEL, fmtNightDate, fmtWhen } from "./format";

const COUNTER_LABEL: [Exclude<keyof NightCounters, "replies">, string][] = [
  ["found", "Encontradas"],
  ["aboveThreshold", "Acima do corte"],
  ["prepared", "Preparadas"],
  ["ready", "Prontas"],
  ["needsInput", "Precisam de resposta"],
  ["failed", "Falharam"],
  ["submitted", "Enviadas"],
  ["uncertain", "Envio incerto"],
  ["waitingLimit", "Aguardando limite"],
  ["windowEnd", "Fim da janela"],
];

export function StatusBadge({ status }: { status: NightRunListItem["status"] }) {
  return <Badge className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Runs list (F6 T011): newest first; clicking a row selects it for the detail panel. */
export function NightRunsList({
  runs,
  selectedId,
  onSelect,
}: {
  runs: NightRunListItem[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (runs.length === 0) return <p className="text-muted-foreground text-sm">Nenhuma execução ainda.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className={`hover:bg-muted/40 flex w-full flex-wrap items-center gap-2 p-3 text-left text-sm ${r.id === selectedId ? "bg-muted/60" : ""}`}
          >
            <span className="font-medium">{fmtNightDate(r.nightDate)}</span>
            <Badge variant="outline">{TRIGGER_LABEL[r.trigger]}</Badge>
            <StatusBadge status={r.status} />
            <span className="text-muted-foreground ml-auto text-xs">
              {r.counters.found} encontradas · {r.counters.ready} prontas · {r.counters.needsInput} precisam de resposta · {r.counters.failed}{" "}
              falharam
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Selected run: phase, counters, step errors, report (F6 T011/T030) and the live log (T033). */
export function NightRunDetail({ run, next, onEnd }: { run: NightRunView; next: WindowView | null; onEnd: () => void }) {
  const running = run.status === "running";
  const c = run.counters;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Execução de {fmtNightDate(run.nightDate)}
          <Badge variant="outline">{TRIGGER_LABEL[run.trigger]}</Badge>
          <StatusBadge status={run.status} />
          <Link href={`/revisao?run=${run.id}`} className="ml-auto text-sm font-normal underline">
            Abrir revisão desta execução →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {[
            `Fase: ${PHASE_LABEL[run.phase]}`,
            `início ${fmtWhen(run.startedAt)}`,
            run.windowEnd ? `janela até ${fmtWhen(run.windowEnd)}` : null,
            run.finishedAt ? `fim ${fmtWhen(run.finishedAt)}` : null,
            `orçamento ${run.budget}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {COUNTER_LABEL.map(([k, label]) => (
            <div key={k} className="rounded-lg border p-2">
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="text-lg font-semibold">{c[k]}</p>
            </div>
          ))}
        </div>
        {c.found > 0 && (
          <p className="text-muted-foreground text-xs">
            {fmtPercent(c.aboveThreshold / c.found)} das vagas encontradas passaram do corte de score.
          </p>
        )}

        {run.pending.length > 0 && (
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            {run.pending.length} candidatura(s) ficaram pendentes no fim da janela.
          </p>
        )}

        {run.stepErrors.length > 0 && (
          <div className="border-destructive/50 bg-destructive/10 space-y-1 rounded-lg border p-3">
            <p className="font-medium">Erros por etapa</p>
            <ul className="space-y-0.5">
              {run.stepErrors.map((e, i) => (
                <li key={`${e.step}-${i}`}>
                  <span className="font-mono text-xs">[{e.step}]</span> {e.message}{" "}
                  <span className="text-muted-foreground text-xs">({fmtWhen(e.at)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ReportPanel run={run} />

        <div className="space-y-2">
          <p className="font-medium">Log</p>
          <LiveLog key={run.id} runId={run.id} initial={run.events} running={running} next={next} onEnd={onEnd} />
        </div>
      </CardContent>
    </Card>
  );
}

function ReportPanel({ run }: { run: NightRunView }) {
  const status =
    run.reportStatus === "not_sent" && run.reportError
      ? `${REPORT_LABEL.not_sent} (${run.reportError})`
      : run.reportStatus === "sent" && run.reportSentAt
        ? `${REPORT_LABEL.sent} em ${fmtWhen(run.reportSentAt)}`
        : REPORT_LABEL[run.reportStatus];
  const r = run.report;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p>
        <span className="font-medium">Relatório:</span>{" "}
        <span className={run.reportStatus === "not_sent" ? "text-destructive" : "text-muted-foreground"}>{status}</span>
      </p>
      {r && (
        <>
          {r.alerts.length > 0 && (
            <ul className="space-y-1">
              {r.alerts.map((a, i) => (
                <li key={`${a.kind}-${i}`} className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1">
                  {a.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            {r.counters.found} encontradas · {r.counters.ready} prontas · {r.counters.needsInput} precisam de resposta · {r.counters.failed}{" "}
            falharam · {r.counters.submitted} enviadas
          </p>
          {r.top.length > 0 && (
            <div>
              <p className="text-xs font-medium">Top {r.top.length}</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                {r.top.map((t, i) => (
                  <li key={`${t.title}-${i}`}>
                    {t.title} <span className="text-muted-foreground">· {t.company || "empresa não informada"} · score {Math.round(t.score)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
