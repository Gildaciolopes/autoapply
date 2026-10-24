"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationListItem, ApplicationSummary } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ApproveBatchResult, applications, errorMessage, preferences } from "@/lib/api";
import { checkboxClass, fmtDateTime } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { AppStatusBadge, ReasonChip } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { ATS_LABEL, isAppBusy, isSubmitPending, refusedLabel } from "./format";

type Tab = "ready" | "needs_input" | "approved" | "submitted" | "submit_uncertain" | "failed" | "queued" | "skipped" | "all";

const TABS: [Tab, string][] = [
  ["ready", "Pronto"],
  ["needs_input", "Precisa de você"],
  ["approved", "Aprovadas"],
  ["submitted", "Enviadas"],
  ["submit_uncertain", "Envio incerto"],
  ["failed", "Falhou"],
  ["queued", "Na fila"],
  ["skipped", "Cancelado"],
  ["all", "Todas"],
];

const anyRunning = (s: ApplicationSummary) => s.queued + s.applying > 0;
const anyActive = (s: ApplicationSummary) => anyRunning(s) || s.approved > 0;

async function loadTab(tab: Tab): Promise<ApplicationListItem[]> {
  if (tab === "all") return applications.list();
  // "Na fila" covers every in-flight state (queued, tailoring, applying).
  if (tab === "queued") return (await applications.list()).filter((a) => isAppBusy(a.status));
  // "Aprovadas" covers approved (waiting in the submit queue) and submitting.
  if (tab === "approved") return (await applications.list()).filter((a) => isSubmitPending(a.status));
  return applications.list(tab);
}

export function ApplicationsList() {
  const [tab, setTab] = useState<Tab>("needs_input");
  const { data, reload } = useLoad(
    async () => {
      const [summary, items] = await Promise.all([applications.summary(), loadTab(tab)]);
      return { summary, items };
    },
    tab,
    {
      pollMs: 5000,
      shouldPoll: (d) => anyActive(d.summary) || d.items.some((a) => isAppBusy(a.status) || isSubmitPending(a.status)),
    },
  );
  const summary = data?.summary;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<{ id: string; title: string; code: string }[]>([]);

  function changeTab(t: Tab) {
    setTab(t);
    setSelected(new Set());
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Only rows still listed (and ready) count as selected.
  const selectedItems = tab === "ready" ? (data?.items ?? []).filter((a) => selected.has(a.id) && a.status === "ready") : [];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Simulações preenchem e fotografam o formulário sem enviar nada. O envio de verdade só acontece para as candidaturas que você
        aprovar (modo Revisão).
      </p>

      {summary && anyActive(summary) && <StopBar summary={summary} onStopped={() => void reload(true)} />}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard title="Pronto" value={summary.ready} onClick={() => changeTab("ready")} />
          <SummaryCard title="Precisa de você" value={summary.needs_input.total} onClick={() => changeTab("needs_input")}>
            <div className="flex flex-wrap gap-1">
              {Object.entries(summary.needs_input.byReason).map(([code, n]) => (
                <ReasonChip key={code} code={code} count={n} />
              ))}
            </div>
          </SummaryCard>
          <SummaryCard title="Aprovadas" value={summary.approved} onClick={() => changeTab("approved")} />
          <SummaryCard title="Enviadas" value={summary.submitted} onClick={() => changeTab("submitted")} />
          <SummaryCard title="Incertas" value={summary.submit_uncertain} onClick={() => changeTab("submit_uncertain")} />
          <SummaryCard title="Falhou" value={summary.failed} onClick={() => changeTab("failed")} />
          <SummaryCard title="Na fila / simulando" value={summary.queued + summary.applying} onClick={() => changeTab("queued")} />
        </div>
      )}

      <BatchCard onQueued={() => void reload(true)} />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && data.items.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma candidatura aqui.</p>}
      {tab === "ready" && data && data.items.length > 0 && (
        <ApproveBatchBar
          items={selectedItems}
          allIds={data.items.filter((a) => a.status === "ready").map((a) => a.id)}
          onSelectAll={(ids) => setSelected(new Set(ids))}
          onDone={(res) => {
            const titles = new Map(data.items.map((a) => [a.id, a.jobTitle]));
            setRefused(res.refused.map((r) => ({ ...r, title: titles.get(r.id) ?? r.id })));
            setSelected(new Set());
            void reload(true);
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

      {data && data.items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {data.items.map((a) => (
            <ApplicationRow
              key={a.id}
              app={a}
              selectable={tab === "ready" && a.status === "ready"}
              selected={selected.has(a.id)}
              onSelect={(on) => toggle(a.id, on)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryCard({ title, value, onClick, children }: { title: string; value: number; onClick: () => void; children?: React.ReactNode }) {
  return (
    <Card className="hover:bg-muted/40 cursor-pointer transition-colors" onClick={onClick}>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold">{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function StopBar({ summary, onStopped }: { summary: ApplicationSummary; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    try {
      const { cancelled } = await applications.stop();
      toast.success(`${cancelled} ${cancelled === 1 ? "candidatura cancelada" : "candidaturas canceladas"}`);
      onStopped();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-destructive/50 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
      <span>
        {summary.queued} na fila · {summary.applying} simulando · {summary.approved} aprovada(s) para envio
      </span>
      <span className="text-muted-foreground ml-auto text-xs">cancela simulações e envios aprovados</span>
      <Button variant="destructive" className="bg-destructive hover:bg-destructive/90 text-white" disabled={busy} onClick={() => void stop()}>
        {busy ? "Parando…" : "Parar tudo"}
      </Button>
    </div>
  );
}

function BatchCard({ onQueued }: { onQueued: () => void }) {
  const [topN, setTopN] = useState(10);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const { queued } = await applications.batch({ topN });
      toast.success(queued.length ? `${queued.length} simulações em fila` : "Nenhuma vaga com currículo pronto para simular");
      onQueued();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        aria-label="Quantidade de vagas"
        type="number"
        min={1}
        max={50}
        className="w-20"
        value={topN}
        onChange={(e) => setTopN(Math.min(50, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
      />
      <Button variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? "Enviando…" : `Simular top ${topN} com currículo pronto`}
      </Button>
    </div>
  );
}

function ApproveBatchBar({
  items,
  allIds,
  onSelectAll,
  onDone,
}: {
  items: ApplicationListItem[];
  allIds: string[];
  onSelectAll: (ids: string[]) => void;
  onDone: (res: ApproveBatchResult) => void;
}) {
  const { data: prefs } = useLoad(() => preferences.get());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reviewMode = prefs?.mode === "review";
  const allSelected = allIds.length > 0 && items.length === allIds.length;

  async function approve() {
    setBusy(true);
    try {
      // API accepts at most 50 ids per call.
      const res: ApproveBatchResult = { approved: [], refused: [] };
      const ids = items.map((a) => a.id);
      for (let i = 0; i < ids.length; i += 50) {
        const part = await applications.approveBatch(ids.slice(i, i + 50));
        res.approved.push(...part.approved);
        res.refused.push(...part.refused);
      }
      setOpen(false);
      if (res.approved.length) toast.success(`${res.approved.length} aprovada(s) — na fila de envio`);
      if (res.refused.length) toast.warning(`${res.refused.length} não aprovada(s)`);
      onDone(res);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked ? allIds : [])}
        />
        Selecionar todas
      </label>
      {prefs && !reviewMode && (
        <span className="text-muted-foreground text-xs">
          Modo simulação: nada é enviado — mude para &apos;Revisão&apos; em{" "}
          <Link href="/vagas/preferencias" className="underline">
            Preferências
          </Link>
        </span>
      )}
      <Button className="ml-auto" disabled={items.length === 0 || !reviewMode || busy} onClick={() => setOpen(true)}>
        Aprovar selecionadas ({items.length})
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Enviar ${items.length} candidatura(s) de verdade?`}
        confirmLabel="Sim, enviar todas"
        busy={busy}
        onConfirm={() => void approve()}
      >
        <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.jobTitle}</span>
              <span className="text-muted-foreground">· {a.company || "empresa não informada"}</span>
              {a.ats && <Badge variant="outline">{ATS_LABEL[a.ats]}</Badge>}
            </li>
          ))}
        </ul>
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 font-medium">
          Estas candidaturas serão ENVIADAS DE VERDADE para as empresas com as respostas e o currículo mostrados na página de cada uma.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function ApplicationRow({
  app,
  selectable,
  selected,
  onSelect,
}: {
  app: ApplicationListItem;
  selectable: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  return (
    <li className="flex items-center">
      {selectable && (
        <input
          type="checkbox"
          aria-label={`Selecionar ${app.jobTitle}`}
          className={`${checkboxClass} ml-3`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      )}
      <Link href={`/vagas/${app.jobId}/candidatura`} className="hover:bg-muted/40 flex min-w-0 flex-1 flex-wrap items-center gap-2 p-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{app.jobTitle}</p>
          <p className="text-muted-foreground truncate text-xs">
            {[app.company || "empresa não informada", `atualizada ${fmtDateTime(app.updatedAt)}`].join(" · ")}
          </p>
        </div>
        {app.ats && <Badge variant="outline">{ATS_LABEL[app.ats]}</Badge>}
        {app.reasonCodes.map((c) => (
          <ReasonChip key={c} code={c} />
        ))}
        {app.outdated && <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400">desatualizada</Badge>}
        <AppStatusBadge status={app.status} />
      </Link>
    </li>
  );
}
