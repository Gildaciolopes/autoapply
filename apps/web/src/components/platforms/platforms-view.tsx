"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PlatformKind, PlatformLimitsBody, PlatformView, SessionStatus } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiRequestError, errorMessage, platforms } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { ATS_LABEL } from "../apply/format";
import { fmtDateTime } from "../kb/format";
import { useLoad } from "../kb/use-load";

/** Mirrors LINKEDIN_OPT_IN_TEXT in @autoapply/shared (value import would pull zod into the client bundle). */
const LINKEDIN_OPT_IN_TEXT = "Entendo e quero usar";

const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  disconnected: "Desconectada",
  connecting: "Aguardando seu login…",
  connected: "Conectada",
  expired: "Expirada — reconecte",
};

const SESSION_STATUS_CLASS: Record<SessionStatus, string> = {
  disconnected: "bg-secondary text-secondary-foreground",
  connecting: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  connected: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  expired: "bg-orange-500/20 text-orange-800 dark:text-orange-400",
};

const PAUSE_REASON_LABEL: Record<string, string> = {
  errors: "erros seguidos",
  unusual_activity: "atividade incomum detectada",
  manual: "pausada manualmente",
};

const platformName = (k: PlatformKind) => ATS_LABEL[k];
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function PlatformsView() {
  const { data, setData, loading, reload } = useLoad(() => platforms.list(), "", {
    pollMs: 2000,
    shouldPoll: (d) => d.some((p) => p.sessionStatus === "connecting"),
  });

  const replace = (v: PlatformView) => setData((prev) => prev?.map((p) => (p.kind === v.kind ? v : p)));
  const refresh = () => void reload(true);
  const sessionPlatforms = data?.filter((p) => p.needsSession) ?? [];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Conecte suas contas para que o AutoApply envie as candidaturas que você aprovar. O login é feito por você, numa janela do navegador
        local; só a sessão (cookies) fica guardada, criptografada, nesta máquina.
      </p>
      {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {sessionPlatforms.map((p) => (
              <SessionCard key={p.kind} p={p} onChange={replace} refresh={refresh} />
            ))}
          </div>
          <LimitsCard items={data} onChange={replace} refresh={refresh} />
        </>
      )}
    </div>
  );
}

// ---------- sessions ----------

function SessionCard({ p, onChange, refresh }: { p: PlatformView; onChange: (v: PlatformView) => void; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [optInOpen, setOptInOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const name = platformName(p.kind);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "opt_in_required") setOptInOpen(true);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      onChange(await platforms.connect(p.kind));
    });

  function onConnectClick() {
    if (p.needsOptIn) setOptInOpen(true);
    else void connect();
  }

  const done = (cancel: boolean) =>
    run(async () => {
      await platforms.connectDone(p.kind, cancel || undefined);
      toast.success(cancel ? "Conexão cancelada" : "Verificando sua sessão…");
      refresh();
    });

  const test = () =>
    run(async () => {
      await platforms.test(p.kind);
      toast.success("Teste de sessão em fila — o resultado aparece aqui em instantes");
      setTimeout(refresh, 4000);
    });

  const disconnect = () =>
    run(async () => {
      await platforms.disconnect(p.kind);
      setDisconnectOpen(false);
      toast.success(`${name} desconectada`);
      refresh();
    });

  const connecting = p.sessionStatus === "connecting";
  const connected = p.sessionStatus === "connected";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          <Badge className={SESSION_STATUS_CLASS[p.sessionStatus]}>{SESSION_STATUS_LABEL[p.sessionStatus]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Conta</dt>
          <dd>{p.accountLabel ?? "—"}</dd>
          <dt className="text-muted-foreground">Conectada em</dt>
          <dd>{fmtDateTime(p.connectedAt)}</dd>
          <dt className="text-muted-foreground">Último teste</dt>
          <dd>
            {fmtDateTime(p.lastTestAt)}
            {p.lastTestOk === true && <span className="text-emerald-700 dark:text-emerald-400"> · sessão válida</span>}
            {p.lastTestOk === false && <span className="text-destructive"> · falhou</span>}
          </dd>
        </dl>

        {connecting && (
          <div className="space-y-3 rounded-lg border border-sky-500/50 bg-sky-500/10 p-3">
            <p>
              Uma janela do navegador vai abrir na página de login da plataforma. Entre na sua conta por lá (inclusive código de
              verificação). O AutoApply não vê nem guarda sua senha.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void done(false)}>
                Concluí
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void done(true)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {!connecting && (
          <div className="flex flex-wrap gap-2">
            {!connected && (
              <Button size="sm" disabled={busy} onClick={onConnectClick}>
                {p.sessionStatus === "expired" ? "Reconectar" : "Conectar"}
              </Button>
            )}
            {connected && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void test()}>
                  Testar sessão
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void connect()}>
                  Reconectar
                </Button>
              </>
            )}
            {(connected || p.sessionStatus === "expired") && (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setDisconnectOpen(true)}>
                Desconectar
              </Button>
            )}
          </div>
        )}

        {p.kind === "linkedin" && p.optInAt && (
          <p className="text-muted-foreground text-xs">Aviso sobre os termos do LinkedIn aceito em {fmtDateTime(p.optInAt)}.</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`Desconectar ${name}?`}
        confirmLabel="Desconectar"
        destructive
        busy={busy}
        onConfirm={() => void disconnect()}
      >
        <p>A sessão salva será apagada. Candidaturas pendentes desta plataforma voltarão para &apos;Precisa de você&apos;.</p>
      </ConfirmDialog>

      {p.kind === "linkedin" && (
        <LinkedinOptInDialog
          open={optInOpen}
          onOpenChange={setOptInOpen}
          submitCap={p.submitCap}
          onAccepted={async (view) => {
            onChange(view);
            setOptInOpen(false);
            await connect();
          }}
        />
      )}
    </Card>
  );
}

function LinkedinOptInDialog({
  open,
  onOpenChange,
  submitCap,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitCap: number;
  onAccepted: (view: PlatformView) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const view = await platforms.optIn(text);
      setText("");
      await onAccepted(view);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setText("");
        onOpenChange(o);
      }}
      title="Usar o LinkedIn para candidaturas?"
      confirmLabel="Ativar e conectar"
      destructive
      busy={busy}
      disabled={text !== LINKEDIN_OPT_IN_TEXT}
      onConfirm={() => void accept()}
    >
      <ul className="list-disc space-y-1 pl-5">
        <li>Os termos de uso do LinkedIn proíbem automação.</li>
        <li>Usar o AutoApply com o LinkedIn pode levar à restrição ou bloqueio da sua conta.</li>
        <li>
          Para reduzir o risco, o limite diário é baixo ({submitCap} {submitCap === 1 ? "envio" : "envios"}/dia; 5/dia por padrão) e cada envio
          continua exigindo a sua aprovação.
        </li>
      </ul>
      <label className="block space-y-1.5">
        <span>
          Para continuar, digite exatamente <strong>{LINKEDIN_OPT_IN_TEXT}</strong>:
        </span>
        <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" aria-label="Texto de confirmação" />
      </label>
    </ConfirmDialog>
  );
}

// ---------- limits ----------

function LimitsCard({ items, onChange, refresh }: { items: PlatformView[]; onChange: (v: PlatformView) => void; refresh: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Limites por plataforma</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items
          .filter((p) => p.paused)
          .map((p) => (
            <PauseBanner key={p.kind} p={p} refresh={refresh} />
          ))}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plataforma</TableHead>
              <TableHead>Envios/dia</TableHead>
              <TableHead>Simulações/dia</TableHead>
              <TableHead>Intervalo mín. (s)</TableHead>
              <TableHead>Uso hoje</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <LimitsRow key={`${p.kind}:${p.submitCap}:${p.simulateCap}:${p.minIntervalSec}`} p={p} onChange={onChange} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PauseBanner({ p, refresh }: { p: PlatformView; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!p.paused) return null;
  async function resume() {
    setBusy(true);
    try {
      await platforms.resume(p.kind);
      toast.success(`${platformName(p.kind)} retomada`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <span>
        <strong>{platformName(p.kind)}</strong> pausada: {PAUSE_REASON_LABEL[p.paused.reason] ?? p.paused.reason}
        {p.paused.until && ` · até ${fmtDateTime(p.paused.until)}`}
      </span>
      <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void resume()}>
        Retomar
      </Button>
    </div>
  );
}

const intOrNaN = (v: string) => (v.trim() === "" ? NaN : Math.trunc(Number(v)));

function LimitsRow({ p, onChange }: { p: PlatformView; onChange: (v: PlatformView) => void }) {
  const [submitCap, setSubmitCap] = useState(String(p.submitCap));
  const [simulateCap, setSimulateCap] = useState(String(p.simulateCap));
  const [minInterval, setMinInterval] = useState(String(p.minIntervalSec));
  const [busy, setBusy] = useState(false);

  const body: PlatformLimitsBody = { submitCap: intOrNaN(submitCap), simulateCap: intOrNaN(simulateCap), minIntervalSec: intOrNaN(minInterval) };
  const dirty = body.submitCap !== p.submitCap || body.simulateCap !== p.simulateCap || body.minIntervalSec !== p.minIntervalSec;
  const error =
    !Number.isFinite(body.submitCap) || body.submitCap! < 0 || body.submitCap! > p.submitMax
      ? `Envios/dia: 0–${p.submitMax}`
      : !Number.isFinite(body.simulateCap) || body.simulateCap! < 0 || body.simulateCap! > 200
        ? "Simulações/dia: 0–200"
        : !Number.isFinite(body.minIntervalSec) || body.minIntervalSec! < 10 || body.minIntervalSec! > 3600
          ? "Intervalo: 10–3600 s"
          : null;

  async function save() {
    setBusy(true);
    try {
      onChange(await platforms.limits(p.kind, body));
      toast.success(`Limites de ${platformName(p.kind)} salvos`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const name = platformName(p.kind);
  return (
    <TableRow>
      <TableCell className="font-medium">
        {name}
        {p.paused && <Badge className="ml-2 bg-amber-500/20 text-amber-800 dark:text-amber-400">pausada</Badge>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={p.submitMax}
            className="w-20"
            aria-label={`Envios por dia ${name}`}
            value={submitCap}
            onChange={(e) => setSubmitCap(e.target.value)}
          />
          <span className="text-muted-foreground text-xs whitespace-nowrap">máx. {p.submitMax}</span>
        </div>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          max={200}
          className="w-20"
          aria-label={`Simulações por dia ${name}`}
          value={simulateCap}
          onChange={(e) => setSimulateCap(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={10}
          max={3600}
          className="w-24"
          aria-label={`Intervalo mínimo ${name}`}
          value={minInterval}
          onChange={(e) => setMinInterval(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        <div>
          {p.usage.submitted}/{p.submitCap} envios · {p.usage.simulated}/{p.simulateCap} simulações
        </div>
        {p.nextRunAt && <div className="text-muted-foreground text-xs">próxima execução às {fmtTime(p.nextRunAt)}</div>}
      </TableCell>
      <TableCell className="text-right">
        {error && dirty && <p className="text-destructive mb-1 text-xs">{error}</p>}
        <Button size="sm" variant="outline" disabled={!dirty || error !== null || busy} onClick={() => void save()}>
          {busy ? "Salvando…" : "Salvar"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
