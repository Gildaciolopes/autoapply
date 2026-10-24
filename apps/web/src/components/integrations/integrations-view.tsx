"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { AssistantSettings, MailAccountView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ApiRequestError, assistant, errorMessage, mail } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { fmtDateTime } from "../kb/format";
import { useLoad } from "../kb/use-load";

/** `?mail=` set by the API's OAuth callback redirect. */
const MAIL_BANNER: Record<string, [string, string]> = {
  connected: ["Gmail conectado.", "border-emerald-600/40 bg-emerald-600/10"],
  denied: ["Você negou o acesso ao Gmail. Nada foi conectado.", "border-amber-500/50 bg-amber-500/10"],
  error: ["Não foi possível conectar o Gmail. Tente de novo.", "border-destructive/50 bg-destructive/10"],
};

/** `/integracoes` (F7 T019 + T028): Gmail (read-only) and the local MCP assistant. */
export function IntegrationsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const banner = MAIL_BANNER[params.get("mail") ?? ""];

  return (
    <div className="space-y-4">
      {banner && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${banner[1]}`}>
          <span>{banner[0]}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => router.replace(pathname)}>
            Fechar
          </Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <GmailCard />
        <AssistantCard />
      </div>
    </div>
  );
}

function GmailCard() {
  const { data, setData, loading, reload } = useLoad(() => mail.get());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      await mail.check();
      toast.success("Verificação em fila");
      setTimeout(() => void reload(true), 5000);
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.code === "not_connected" ? "Conecte o Gmail primeiro" : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      setData(await mail.disconnect());
      setConfirming(false);
      toast.success("Gmail desconectado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Gmail
          {data && <MailStatusBadge view={data} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Somente leitura: o AutoApply nunca envia, apaga ou altera emails. Guardamos apenas remetente, assunto, data e um trecho de até 300
          caracteres dos emails ligados a candidaturas.
        </p>
        {loading && !data && <p className="text-muted-foreground">Carregando…</p>}
        {data && !data.configured && <SetupSteps />}
        {data?.configured && data.status === "expired" && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">Acesso expirou: reconecte.</div>
        )}
        {data?.configured && data.status !== "connected" && (
          // Plain navigation: the API redirects to Google, where the user signs in themselves.
          <a href={mail.connectUrl()} className={buttonVariants()}>
            Conectar Gmail
          </a>
        )}
        {data?.configured && data.status === "connected" && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Conta</dt>
              <dd className="font-medium">{data.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Conectado em</dt>
              <dd>{fmtDateTime(data.connectedAt)}</dd>
              <dt className="text-muted-foreground">Última verificação</dt>
              <dd>{fmtDateTime(data.lastCheckAt)}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void check()}>
                Verificar agora
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
                Desconectar
              </Button>
            </div>
          </>
        )}
        {data?.lastError && <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3">Último erro: {data.lastError}</div>}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Desconectar o Gmail?"
        confirmLabel="Desconectar"
        destructive
        busy={busy}
        onConfirm={() => void disconnect()}
      >
        <p className="text-sm">
          O acesso é revogado no Google e os tokens são apagados. As respostas já registradas continuam aqui; novos emails deixam de ser
          lidos.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function MailStatusBadge({ view }: { view: MailAccountView }) {
  if (!view.configured) return <Badge variant="secondary">não configurado</Badge>;
  if (view.status === "connected") return <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">conectado</Badge>;
  if (view.status === "expired") return <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-400">expirado</Badge>;
  return <Badge variant="outline">desconectado</Badge>;
}

function SetupSteps() {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">Configurar (uma vez)</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>No Google Cloud Console, crie um projeto seu e ative a Gmail API.</li>
        <li>
          Configure a tela de consentimento OAuth em modo <strong>Testing</strong> e adicione seu endereço como usuário de teste.
        </li>
        <li>
          Crie um cliente OAuth do tipo <strong>Desktop app</strong>.
        </li>
        <li>
          Coloque <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no <code>.env</code> e reinicie (<code>make dev</code>).
        </li>
      </ol>
    </div>
  );
}

const ASSISTANT_CAN = [
  "ler vagas e o score de cada uma",
  "ler candidaturas e a fila de revisão",
  "ler o relatório da noite",
  "ler as análises do funil",
  "parar tudo (o mesmo botão de emergência da interface)",
];

function AssistantCard() {
  const { data, setData, loading } = useLoad(() => assistant.settings());
  const [busy, setBusy] = useState(false);
  const command = data ? `claude mcp add --transport http autoapply ${data.url}` : "";

  async function toggle(approveEnabled: boolean) {
    setBusy(true);
    try {
      setData((await assistant.save(approveEnabled)) satisfies AssistantSettings);
      toast.success(approveEnabled ? "Aprovação pelo assistente ligada" : "Aprovação pelo assistente desligada");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Comando copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assistente (MCP)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading && !data && <p className="text-muted-foreground">Carregando…</p>}
        {data && (
          <>
            <p>
              Endereço: <code>{data.url}</code>
            </p>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Para conectar o Claude Code, rode no terminal:</p>
              <div className="flex items-center gap-2">
                <code className="bg-muted flex-1 overflow-x-auto rounded-md px-2 py-1.5 text-xs whitespace-nowrap">{command}</code>
                <Button size="sm" variant="outline" onClick={() => void copy()}>
                  Copiar
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground">Só aceita conexões desta máquina.</p>
            <div className="space-y-1">
              <p className="font-medium">O assistente pode:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {ASSISTANT_CAN.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              <label className="flex items-center gap-2 font-medium">
                <Switch checked={data.approveEnabled} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
                Permitir aprovar pelo assistente
              </label>
              <p className="text-muted-foreground text-xs">
                Desligado por padrão. Ligado, o assistente só aprova candidaturas que você nomear (até 10), mostra uma prévia e só aprova
                depois que você confirmar. Nunca &quot;aprovar todas&quot;.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
