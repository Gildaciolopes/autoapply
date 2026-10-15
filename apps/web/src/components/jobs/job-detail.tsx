"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { JobCard } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { jobs, type JobDetail } from "@/lib/api";
import { useLoad } from "../kb/use-load";
import { ScoreBadge } from "./feed";
import {
  FILTER_REASON_LABEL,
  SENIORITY_LABEL,
  SOURCE_LABEL,
  WORK_MODE_LABEL,
  fmtAge,
  fmtLocation,
  fmtSalary,
  label,
} from "./format";
import { JobActions } from "./job-actions";

function factSearchHref(summary: string): string {
  const word = summary.trim().split(/\s+/)[0] ?? "";
  return `/conhecimento/fatos?q=${encodeURIComponent(word)}`;
}

export function JobDetailView() {
  const { id } = useParams<{ id: string }>();
  const { data: job, setData, loading, reload } = useLoad(() => jobs.get(id), id);

  if (loading && !job) return <p className="text-muted-foreground text-sm">Carregando…</p>;
  if (!job)
    return (
      <p className="text-muted-foreground text-sm">
        Vaga não encontrada.{" "}
        <Link href="/vagas" className="underline">
          Voltar ao feed
        </Link>
      </p>
    );

  const s = job.score;
  const update = (patch: Partial<JobCard>) => setData((prev) => (prev ? ({ ...prev, ...patch } as JobDetail) : prev));

  return (
    <div className="space-y-4">
      <Link href="/vagas" className="text-muted-foreground text-sm hover:underline">
        ← Feed
      </Link>

      <div className="flex gap-4">
        <ScoreBadge job={job} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{job.title}</h2>
            {job.possiblyClosed && <Badge variant="secondary">possivelmente encerrada</Badge>}
            {s && !s.passed && s.filterReason && <Badge variant="destructive">filtrada: {FILTER_REASON_LABEL[s.filterReason]}</Badge>}
            {job.hidden && <Badge variant="outline">oculta</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {[
              job.company ?? "empresa não informada",
              fmtLocation(job),
              job.workMode ? label(WORK_MODE_LABEL, job.workMode) : null,
              job.seniority ? label(SENIORITY_LABEL, job.seniority) : null,
              fmtSalary(job),
              `publicada ${fmtAge(job.postedAt ?? job.firstSeenAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <JobActions job={job} onChange={update} onBlocked={() => void reload(true)} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {s ? (
              <>
                <p>
                  Score final: <strong>{s.score}</strong>
                </p>
                <p>Similaridade (embeddings): {s.similarity == null ? "—" : `${Math.round(s.similarity * 100)}%`}</p>
                <p>Avaliação do LLM: {s.judged ? `${s.score}/100` : "não avaliado em detalhe"}</p>
                {s.reasons && <p className="pt-2 whitespace-pre-line">{s.reasons}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">Ainda sem score.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Origens</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {job.origins.map((o) => (
                <li key={`${o.source}:${o.url}`}>
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {label(SOURCE_LABEL, o.source)} ↗
                  </a>
                </li>
              ))}
              {job.applyUrl && job.applyUrl !== job.url && (
                <li>
                  <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Link de candidatura ↗
                  </a>
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="font-medium">Que batem com seu perfil</p>
            {job.matchedEvidence.length === 0 && <p className="text-muted-foreground">Nenhuma.</p>}
            <ul className="space-y-2">
              {job.matchedEvidence.map((m) => (
                <li key={m.skill}>
                  <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">✓ {m.skill}</Badge>
                  {m.facts.length > 0 && (
                    <ul className="text-muted-foreground mt-1 ml-4 list-disc space-y-0.5">
                      {m.facts.map((f) => (
                        <li key={f.id}>
                          <Link href={factSearchHref(f.summary)} className="hover:underline">
                            {f.summary}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Que faltam</p>
            {(s?.missing.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">Nenhuma.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {s!.missing.map((m) => (
                  <Badge key={m} variant="secondary" className="text-muted-foreground">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Descrição</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm leading-relaxed whitespace-pre-line">{job.description || "Sem descrição."}</div>
        </CardContent>
      </Card>
    </div>
  );
}
