"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ControlState } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { control, errorMessage } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { PHASE_LABEL, TZ } from "../night/format";

const POLL_MS = 10_000;

const fmtHHMM = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Global kill switch (F6 T016): one "Parar tudo" for the night, simulations and approved-not-sent submissions. */
export function ControlBar() {
  const [state, setState] = useState<ControlState | null>(null);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await control.state());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await refresh();
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refresh]);

  async function stop() {
    setBusy(true);
    try {
      const res = await control.stop();
      setOpen(false);
      const parts = [`${res.cancelled} ${res.cancelled === 1 ? "item cancelado" : "itens cancelados"}`];
      if (res.runStopped) parts.push("execução noturna parada");
      toast.success(`Tudo parado — ${parts.join(" · ")}. Agendamento pausado até "Retomar".`);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    try {
      setState(await control.resume());
      toast.success("Agendamento retomado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {offline && <span className="text-muted-foreground text-xs">API indisponível</span>}
      {state?.running && (
        <Link href="/noite" className="flex items-center gap-1.5 text-xs hover:underline">
          <span className="size-2 animate-pulse rounded-full bg-sky-500" aria-hidden />
          Noite em andamento · {PHASE_LABEL[state.running.phase]}
        </Link>
      )}
      {state?.paused && (
        <>
          <Badge className="bg-orange-500/20 text-orange-800 dark:text-orange-400">
            Pausado{state.pausedAt ? ` desde ${fmtHHMM(state.pausedAt)}` : ""}
          </Badge>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
            Retomar
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="destructive"
        className="bg-destructive hover:bg-destructive/90 text-white"
        disabled={busy || offline}
        onClick={() => setOpen(true)}
      >
        Parar tudo
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Parar tudo?"
        confirmLabel="Sim, parar tudo"
        destructive
        busy={busy}
        onConfirm={() => void stop()}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Para a execução noturna em andamento (se houver).</li>
          <li>Cancela buscas, adaptações e simulações na fila.</li>
          <li>Cancela candidaturas aprovadas que ainda não foram enviadas (voltam para &quot;Prontas&quot;).</li>
          <li>Pausa o agendamento noturno até você clicar em &quot;Retomar&quot;.</li>
        </ul>
        <p className="text-muted-foreground text-xs">Um envio que já está acontecendo neste instante não é interrompido.</p>
      </ConfirmDialog>
    </div>
  );
}
