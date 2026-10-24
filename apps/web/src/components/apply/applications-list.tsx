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
import { applications, errorMessage } from "@/lib/api";
import { fmtDateTime } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { AppStatusBadge, ReasonChip } from "./badges";
import { ATS_LABEL, isAppBusy } from "./format";

type Tab = "ready" | "needs_input" | "failed" | "queued" | "skipped" | "all";

const TABS: [Tab, string][] = [
  ["ready", "Pronto"],
  ["needs_input", "Precisa de você"],
  ["failed", "Falhou"],
  ["queued", "Na fila"],
  ["skipped", "Cancelado"],
  ["all", "Todas"],
];

const anyRunning = (s: ApplicationSummary) => s.queued + s.applying > 0;

async function loadTab(tab: Tab): Promise<ApplicationListItem[]> {
  if (tab === "all") return applications.list();
  // "Na fila" covers every in-flight state (queued, tailoring, applying).
  if (tab === "queued") return (await applications.list()).filter((a) => isAppBusy(a.status));
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
    { pollMs: 5000, shouldPoll: (d) => anyRunning(d.summary) || d.items.some((a) => isAppBusy(a.status)) },
  );
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Simulações em modo dry-run: o formulário é preenchido e fotografado, mas nada é enviado.
      </p>

      {summary && anyRunning(summary) && <StopBar summary={summary} onStopped={() => void reload(true)} />}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard title="Pronto" value={summary.ready} onClick={() => setTab("ready")} />
          <SummaryCard title="Precisa de você" value={summary.needs_input.total} onClick={() => setTab("needs_input")}>
            <div className="flex flex-wrap gap-1">
              {Object.entries(summary.needs_input.byReason).map(([code, n]) => (
                <ReasonChip key={code} code={code} count={n} />
              ))}
            </div>
          </SummaryCard>
          <SummaryCard title="Falhou" value={summary.failed} onClick={() => setTab("failed")} />
          <SummaryCard title="Na fila / simulando" value={summary.queued + summary.applying} onClick={() => setTab("queued")} />
        </div>
      )}

      <BatchCard onQueued={() => void reload(true)} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && data.items.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma candidatura aqui.</p>}
      {data && data.items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {data.items.map((a) => (
            <ApplicationRow key={a.id} app={a} />
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
      toast.success(`${cancelled} ${cancelled === 1 ? "simulação cancelada" : "simulações canceladas"}`);
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
        {summary.queued} na fila · {summary.applying} simulando
      </span>
      <Button variant="destructive" className="bg-destructive hover:bg-destructive/90 ml-auto text-white" disabled={busy} onClick={() => void stop()}>
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

function ApplicationRow({ app }: { app: ApplicationListItem }) {
  return (
    <li>
      <Link href={`/vagas/${app.jobId}/candidatura`} className="hover:bg-muted/40 flex flex-wrap items-center gap-2 p-3 text-sm">
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
