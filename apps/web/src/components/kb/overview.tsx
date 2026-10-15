"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ProfileSourceView, SyncRunView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { conflicts, errorMessage, facts, sources, sync } from "@/lib/api";
import { fmtDateTime, originLabel } from "./format";
import { useLoad } from "./use-load";

interface OverviewData {
  total: number;
  verified: number;
  openConflicts: number;
  sources: ProfileSourceView[];
  runs: SyncRunView[];
}

async function loadOverview(): Promise<OverviewData> {
  const [all, open, srcs, runs] = await Promise.all([facts.list(), conflicts.list("open"), sources.list(), sync.runs(5)]);
  return {
    total: all.length,
    verified: all.filter((f) => f.verifiedByUser).length,
    openConflicts: open.length,
    sources: srcs,
    runs,
  };
}

const STATUS_VARIANT = {
  success: "default",
  partial: "secondary",
  failed: "destructive",
  skipped: "outline",
} as const;

const STATUS_LABEL: Record<string, string> = {
  success: "sucesso",
  partial: "parcial",
  failed: "falhou",
  skipped: "ignorado",
};

export function Overview() {
  const { data, reload, loading } = useLoad(loadOverview);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>, success: string) {
    setBusy(label);
    try {
      await fn();
      toast.success(success);
      await reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Não foi possível carregar."}</p>;

  const stats = [
    ["Fatos", data.total, "/conhecimento/fatos"],
    ["Verificados", data.verified, "/conhecimento/fatos?verified=true"],
    ["Não verificados", data.total - data.verified, "/conhecimento/fatos?verified=false"],
    ["Conflitos abertos", data.openConflicts, "/conhecimento/conflitos"],
  ] as const;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, n, href]) => (
          <Link key={label} href={href}>
            <Card className="hover:bg-muted/40 transition-colors">
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl">{n}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Fontes</h2>
          <Button
            disabled={busy !== null}
            onClick={() => run("sync", sync.now, "Sincronização iniciada")}
          >
            {busy === "sync" ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.sources.map((s) => (
            <SourceCard
              key={s.origin}
              source={s}
              busy={busy}
              onToggle={(enabled) =>
                run(`toggle-${s.origin}`, () => sources.patch(s.origin, enabled), enabled ? "Fonte ativada" : "Fonte desativada")
              }
              onImport={() => run(`import-${s.origin}`, () => sources.import(s.origin), "Importação iniciada")}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Última sincronização</h2>
        {data.runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma sincronização ainda.</p>
        ) : (
          <SyncRunCard run={data.runs[0]} />
        )}
        {data.runs.length > 1 && (
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">Anteriores</summary>
            <div className="mt-2 space-y-2">
              {data.runs.slice(1).map((r) => (
                <SyncRunCard key={r.id} run={r} />
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}

function SourceCard({
  source: s,
  busy,
  onToggle,
  onImport,
}: {
  source: ProfileSourceView;
  busy: string | null;
  onToggle: (enabled: boolean) => void;
  onImport: () => void;
}) {
  const name = s.origin === "github" ? "GitHub" : "LinkedIn";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            {s.origin === "linkedin" ? "Opt-in" : "Ativo"}
            <Switch checked={s.enabled} disabled={busy !== null} onCheckedChange={(v) => onToggle(v)} />
          </label>
        </div>
        <CardDescription>{s.account ? `Conta: ${s.account}` : "Conta não identificada"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {s.origin === "linkedin" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            O LinkedIn proíbe automação nos termos de uso; a importação só lê seu próprio perfil, no máximo 1x por dia.
          </p>
        )}
        {!s.configured && (
          <p className="text-muted-foreground">
            Não configurado: {s.origin === "github" ? "defina GITHUB_TOKEN no .env" : "defina LINKEDIN_MCP_URL no .env"}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {s.lastStatus ? (
            <Badge variant={STATUS_VARIANT[s.lastStatus]}>{STATUS_LABEL[s.lastStatus]}</Badge>
          ) : (
            <Badge variant="outline">nunca sincronizado</Badge>
          )}
          <span className="text-muted-foreground">Última: {fmtDateTime(s.lastSyncAt)}</span>
        </div>
        {s.lastError && (
          <p className="text-destructive">
            {s.lastError === "session_expired" ? (
              <>
                Sessão expirada: rode <code className="font-mono">make linkedin-login</code>
              </>
            ) : (
              s.lastError
            )}
          </p>
        )}
        <Button variant="outline" size="sm" disabled={!s.enabled || busy !== null} onClick={onImport}>
          {busy === `import-${s.origin}` ? "Importando…" : "Importar agora"}
        </Button>
      </CardContent>
    </Card>
  );
}

const TRIGGER_LABEL: Record<SyncRunView["trigger"], string> = {
  schedule: "agendada",
  manual: "manual",
  import: "importação",
};

function SyncRunCard({ run }: { run: SyncRunView }) {
  const { added, conflicted, missing } = run.summary;
  return (
    <Card size="sm">
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{fmtDateTime(run.startedAt)}</span>
          <Badge variant="outline">{TRIGGER_LABEL[run.trigger]}</Badge>
          {!run.finishedAt && <Badge variant="secondary">em andamento</Badge>}
          {Object.entries(run.outcomes).map(([origin, o]) => (
            <Badge key={origin} variant={STATUS_VARIANT[o.status]} title={o.error}>
              {originLabel(origin)}: {STATUS_LABEL[o.status]}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          <span>
            <strong>{added.length}</strong> adicionados
          </span>
          <Link href="/conhecimento/conflitos" className="hover:underline">
            <strong>{conflicted.length}</strong> em conflito
          </Link>
          <span>
            <strong>{missing.length}</strong> sumiram da fonte
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-3">
          {Object.entries(run.outcomes).map(([origin, o]) => (
            <Link key={origin} href={`/conhecimento/fatos?origin=${origin}`} className="hover:underline">
              Ver fatos de {originLabel(origin)}
              {o.counts ? ` (+${o.counts.added}, ${o.counts.conflicts} conflitos, ${o.counts.missing} ausentes)` : ""}
            </Link>
          ))}
          {Object.entries(run.outcomes)
            .filter(([, o]) => o.error)
            .map(([origin, o]) => (
              <span key={`${origin}-err`} className="text-destructive">
                {originLabel(origin)}: {o.error === "session_expired" ? "sessão expirada — rode make linkedin-login" : o.error}
              </span>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
