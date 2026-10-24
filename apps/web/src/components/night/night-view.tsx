"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage, night } from "@/lib/api";
import { useLoad } from "../kb/use-load";
import { NightRunDetail, NightRunsList } from "./night-runs";
import { NightSettingsCard } from "./night-settings";

const RUN_POLL_MS = 5000;

/** `/noite` (F6 US1/US4/US6): window settings, "Rodar agora", runs, selected run detail + live log. */
export function NightView() {
  const settings = useLoad(() => night.settings());
  const runs = useLoad(() => night.runs(), "", {
    pollMs: RUN_POLL_MS,
    shouldPoll: (d) => d.some((r) => r.status === "running"),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const list = runs.data ?? [];
  const selectedId = chosen ?? list.find((r) => r.status === "running")?.id ?? list[0]?.id;

  const detail = useLoad(() => (selectedId ? night.run(selectedId) : Promise.resolve(null)), selectedId ?? "", {
    pollMs: RUN_POLL_MS,
    shouldPoll: (d) => d?.status === "running",
  });
  const run = detail.data && detail.data.id === selectedId ? detail.data : null;

  async function startNow() {
    setStarting(true);
    try {
      const r = await night.start();
      toast.success("Execução iniciada");
      setChosen(r.id);
      await runs.reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const refreshAll = () => {
    void runs.reload(true);
    void detail.reload(true);
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        À noite o AutoApply busca vagas, adapta o currículo e simula as candidaturas — nada é enviado sem a sua aprovação na{" "}
        <Link href="/revisao" className="underline">
          Revisão
        </Link>{" "}
        pela manhã.
      </p>

      {settings.data ? (
        <NightSettingsCard
          key={JSON.stringify(settings.data)}
          settings={settings.data}
          onSaved={(s) => settings.setData(s)}
        />
      ) : (
        <p className="text-muted-foreground text-sm">Carregando…</p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Execuções</h2>
          <Button className="ml-auto" disabled={starting} onClick={() => void startNow()}>
            {starting ? "Iniciando…" : "Rodar agora"}
          </Button>
        </div>
        {runs.data ? (
          <NightRunsList runs={list} selectedId={selectedId} onSelect={setChosen} />
        ) : (
          <p className="text-muted-foreground text-sm">Carregando…</p>
        )}
      </section>

      {run && <NightRunDetail run={run} next={settings.data?.next ?? null} onEnd={refreshAll} />}
    </div>
  );
}
