"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ApplicationView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiRequestError, applications, errorMessage, preferences } from "@/lib/api";
import { fmtDateTime } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { AppStatusBadge, ReasonChip } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import {
  ATS_LABEL,
  REASON_HINT,
  SOURCE_LABEL,
  fmtPercent,
  groupArtifacts,
  isAppBusy,
  isSubmitPending,
  refusedLabel,
  shotLabel,
} from "./format";
import { NeedsInputForm } from "./needs-input-form";
import { ApplicationReplies } from "../replies/application-replies";
import { OutcomeBadge } from "../replies/format";

/** Finds the job's application (list ≤ 200) once, then reloads it by id. */
export function ApplicationPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const appIdRef = useRef<string | null>(null);
  const { data, setData, loading, reload } = useLoad<ApplicationView | null>(
    async () => {
      if (!appIdRef.current) {
        const item = (await applications.list()).find((a) => a.jobId === jobId);
        if (!item) return null;
        appIdRef.current = item.id;
      }
      return applications.get(appIdRef.current);
    },
    jobId,
    { pollMs: 3000, shouldPoll: (d) => isAppBusy(d?.status) || isSubmitPending(d?.status) },
  );

  const replace = (view: ApplicationView) => {
    appIdRef.current = view.id;
    setData(view);
  };

  return (
    <div className="space-y-4">
      <Link href={`/vagas/${jobId}`} className="text-muted-foreground text-sm hover:underline">
        ← Vaga
      </Link>
      {loading && data === undefined && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data === null && <StartCard jobId={jobId} onStarted={replace} />}
      {data && <ApplicationDetail app={data} onChange={replace} reload={() => void reload(true)} />}
    </div>
  );
}

function StartCard({ jobId, onStarted }: { jobId: string; onStarted: (v: ApplicationView) => void }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      onStarted(await applications.start(jobId));
      toast.success("Simulação em fila");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-3 pt-4 text-sm">
        <p>
          Ainda não há simulação para esta vaga. A simulação abre o formulário da vaga, preenche cada campo com seus dados verificados e
          tira screenshots — sem enviar nada (modo dry-run).
        </p>
        <Button disabled={busy} onClick={() => void start()}>
          {busy ? "Enviando…" : "Simular candidatura"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Statuses after approval: re-simulating would discard what was (or is being) sent. */
const LOCKED = new Set<ApplicationView["status"]>(["approved", "submitting", "submitted", "submit_uncertain", "already_applied"]);

const platformLabel = (app: ApplicationView) => {
  const k = app.platform ?? app.ats;
  return k ? (ATS_LABEL[k as keyof typeof ATS_LABEL] ?? k) : "—";
};

function ApplicationDetail({ app, onChange, reload }: { app: ApplicationView; onChange: (v: ApplicationView) => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const running = isAppBusy(app.status);
  const locked = LOCKED.has(app.status);

  async function rerun() {
    setBusy(true);
    try {
      onChange(await applications.rerun(app.id));
      toast.success("Nova simulação em fila");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const blocking = app.answers.filter((a) => a.blocking);
  const last = [...app.artifacts].reverse().find((a) => a.label === "last");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{app.jobTitle}</h2>
          {app.ats && <Badge variant="outline">{ATS_LABEL[app.ats]}</Badge>}
          <AppStatusBadge status={app.status} submittedVia={app.submittedVia} />
          <OutcomeBadge outcome={app.outcome} />
        </div>
        <p className="text-muted-foreground text-sm">
          {[
            app.company || "empresa não informada",
            `${app.attempts} ${app.attempts === 1 ? "tentativa" : "tentativas"}`,
            app.lastRunAt ? `última execução ${fmtDateTime(app.lastRunAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{app.mode === "dry_run" ? "simulação (nada é enviado)" : app.mode === "review" ? "revisão (envio real após aprovação)" : app.mode}</Badge>
          {app.formUrl && (
            <a href={app.formUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground text-sm hover:underline">
              Formulário ↗
            </a>
          )}
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy || running || locked} onClick={() => void rerun()}>
            {busy ? "Enviando…" : "Rodar de novo"}
          </Button>
        </div>
      </div>

      {running && <p className="text-muted-foreground text-sm">Simulando no navegador local… a página atualiza sozinha.</p>}
      {app.status === "approved" && (
        <p className="text-muted-foreground text-sm">Aprovada {fmtDateTime(app.approvedAt)} — na fila de envio. Use &quot;Parar tudo&quot; em Candidaturas para cancelar.</p>
      )}
      {app.status === "submitting" && <p className="text-muted-foreground text-sm">Enviando para a plataforma… a página atualiza sozinha.</p>}

      {app.status === "ready" && <ApproveBar app={app} onApproved={onChange} />}
      {app.status === "submit_uncertain" && <UncertainCard app={app} onMarked={reload} />}
      {app.status === "submitted" && <SubmittedCard app={app} />}

      {app.outdated && !locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3 text-sm">
          <span>Seus dados mudaram desde esta simulação.</span>
          <Button size="sm" disabled={busy || running || locked} onClick={() => void rerun()}>
            Simular de novo
          </Button>
        </div>
      )}

      {app.error && (
        <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3 text-sm">Erro: {app.error}</div>
      )}
      {app.submitError && (
        <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3 text-sm">Erro no envio: {app.submitError}</div>
      )}

      {app.needsReasons.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Motivos</p>
          <ul className="space-y-1">
            {app.needsReasons.map((r, i) => (
              <li key={`${r.code}:${r.fieldKey ?? ""}:${i}`} className="flex flex-wrap items-center gap-2">
                <ReasonChip code={r.code} />
                <span>{REASON_HINT[r.code] ?? r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {app.status === "needs_input" && (blocking.length > 0 || app.reasonCodes.length > 0) && (
        <NeedsInputForm app={app} blocking={blocking} lastShotUrl={last ? applications.artifactUrl(app.id, last.id) : null} onSaved={onChange} />
      )}

      <ApplicationReplies app={app} onChanged={reload} />
      <ReportCard app={app} />
      <AnswersCard app={app} />
      <ScreenshotsCard app={app} />
      {!running && app.artifacts.length === 0 && app.answers.length === 0 && (
        <Button size="sm" variant="ghost" onClick={reload}>
          Atualizar
        </Button>
      )}
    </div>
  );
}

function ApproveBar({ app, onApproved }: { app: ApplicationView; onApproved: (v: ApplicationView) => void }) {
  const { data: prefs } = useLoad(() => preferences.get());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reviewMode = prefs?.mode === "review";

  async function approve() {
    setBusy(true);
    try {
      onApproved(await applications.approve(app.id));
      setOpen(false);
      toast.success("Aprovada — candidatura na fila de envio");
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.status === 409 ? `Não aprovada: ${refusedLabel(err.code)}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const blockedHint = !prefs
    ? null
    : !reviewMode
      ? "Modo simulação: nada é enviado — mude para 'Revisão' em Preferências"
      : app.outdated
        ? "Seus dados mudaram: simule de novo"
        : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
      <span>Revise as respostas e screenshots abaixo. Nada é enviado sem a sua aprovação.</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {blockedHint && (
          <span className="text-muted-foreground text-xs">
            {blockedHint}
            {!reviewMode && (
              <>
                {" "}
                <Link href="/vagas/preferencias" className="underline">
                  Preferências
                </Link>
              </>
            )}
          </span>
        )}
        <Button disabled={!prefs || blockedHint !== null || busy} onClick={() => setOpen(true)}>
          Aprovar e enviar
        </Button>
      </div>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Enviar candidatura de verdade?" confirmLabel="Sim, enviar" busy={busy} onConfirm={() => void approve()}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Vaga</dt>
          <dd className="font-medium">{app.jobTitle}</dd>
          <dt className="text-muted-foreground">Empresa</dt>
          <dd>{app.company || "empresa não informada"}</dd>
          <dt className="text-muted-foreground">Plataforma</dt>
          <dd>{platformLabel(app)}</dd>
        </dl>
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 font-medium">
          Esta candidatura será ENVIADA DE VERDADE para a empresa com as respostas e o currículo mostrados nesta página.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function UncertainCard({ app, onMarked }: { app: ApplicationView; onMarked: () => void }) {
  const [busy, setBusy] = useState(false);
  async function mark(sent: boolean) {
    setBusy(true);
    try {
      await applications.mark(app.id, sent);
      toast.success(sent ? "Marcada como enviada" : "Marcada como não enviada — voltou para 'Pronto'");
      onMarked();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3 text-sm">
      <p className="font-medium">Não confirmamos o envio. Verifique na plataforma e marque:</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void mark(true)}>
          Foi enviada
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void mark(false)}>
          Não foi enviada
        </Button>
        {app.formUrl && (
          <a href={app.formUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground self-center hover:underline">
            Abrir na plataforma ↗
          </a>
        )}
      </div>
    </div>
  );
}

function SubmittedCard({ app }: { app: ApplicationView }) {
  const latest = (label: string) => [...app.artifacts].reverse().find((a) => a.label === label);
  const shots = [latest("confirmation"), latest("submit-filled")].filter((a) => a !== undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enviado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Enviada em <strong>{fmtDateTime(app.submittedAt)}</strong>
          {app.submittedVia === "assisted" && " · você concluiu o envio na janela aberta"}
          {app.submittedVia === "manual" && " · marcada como enviada por você"}
        </p>
        {app.sentValues && app.sentValues.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pergunta</TableHead>
                <TableHead>Valor enviado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {app.sentValues.map((v) => (
                <TableRow key={v.fieldKey}>
                  <TableCell className="max-w-72 whitespace-normal">{v.question}</TableCell>
                  <TableCell className="max-w-96 whitespace-pre-line">{v.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {shots.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shots.map((a) => {
              const url = applications.artifactUrl(app.id, a.id);
              return (
                <a key={a.id} href={url} target="_blank" rel="noopener noreferrer" className="group space-y-1" title="Abrir em tamanho real">
                  {/* eslint-disable-next-line @next/next/no-img-element -- API-served PNG, not optimizable */}
                  <img src={url} alt={shotLabel(a.label)} loading="lazy" className="h-64 w-full rounded-md border object-cover object-top group-hover:opacity-80" />
                  <span className="text-muted-foreground text-xs">{shotLabel(a.label)}</span>
                </a>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportCard({ app }: { app: ApplicationView }) {
  const r = app.report;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Relatório da simulação</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Envios do formulário:{" "}
          {r.submitAttempts === 0 ? (
            <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">Nenhum envio</Badge>
          ) : (
            <Badge variant="destructive">{r.submitAttempts} tentativa(s) bloqueada(s)</Badge>
          )}
        </p>
        <p>
          Requisições bloqueadas: <strong>{r.blockedRequests.length}</strong>
          {r.scriptSubmits > 0 && <span className="text-muted-foreground"> · {r.scriptSubmits} envio(s) de scripts da página barrados</span>}
        </p>
        <p>Etapas do formulário: {r.steps}</p>
        {r.captchaOnSubmit && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            Este formulário usa captcha no envio — o envio real (F5) pedirá sua ação.
          </div>
        )}
        {r.blockedRequests.length > 0 && (
          <details>
            <summary className="text-muted-foreground cursor-pointer text-xs">Ver requisições bloqueadas</summary>
            <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs break-all">
              {r.blockedRequests.map((b, i) => (
                <li key={i}>
                  <code>{b.method}</code> {b.url}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function AnswersCard({ app }: { app: ApplicationView }) {
  if (app.answers.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campos ({app.answers.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Etapa</TableHead>
              <TableHead>Pergunta</TableHead>
              <TableHead>Resposta</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead>Fatos</TableHead>
              <TableHead>Preenchido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {app.answers.map((a) => (
              <TableRow key={a.id} className={a.blocking ? "bg-amber-500/10" : undefined}>
                <TableCell>{a.step + 1}</TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  {a.question}
                  {a.required && <span className="text-destructive"> *</span>}
                  {a.blocking && a.reason && (
                    <div className="mt-1">
                      <ReasonChip code={a.reason} />
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-80 whitespace-pre-line">{a.answer ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{SOURCE_LABEL[a.source] ?? a.source}</Badge>
                </TableCell>
                <TableCell>{fmtPercent(a.confidence)}</TableCell>
                <TableCell title={a.evidence.join(", ")}>{a.evidence.length}</TableCell>
                <TableCell>
                  {a.filled ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                  ) : (
                    <span className="text-destructive">✗</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ScreenshotsCard({ app }: { app: ApplicationView }) {
  const groups = groupArtifacts(app.artifacts);
  if (groups.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Screenshots</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {groups.map((g) => (
          <div key={g.attempt} className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase">Tentativa {g.attempt}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.items.map((a) => {
                const url = applications.artifactUrl(app.id, a.id);
                return (
                  <a key={a.id} href={url} target="_blank" rel="noopener noreferrer" className="group space-y-1" title="Abrir em tamanho real">
                    {/* eslint-disable-next-line @next/next/no-img-element -- API-served PNG, not optimizable */}
                    <img
                      src={url}
                      alt={shotLabel(a.label)}
                      loading="lazy"
                      className="h-40 w-full rounded-md border object-cover object-top group-hover:opacity-80"
                    />
                    <span className="text-muted-foreground text-xs">{shotLabel(a.label)}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
