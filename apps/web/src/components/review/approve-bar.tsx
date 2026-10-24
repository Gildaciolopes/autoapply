"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { AtsKind, ReviewItem, SendEstimate } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { type ApproveBatchResult, applications, errorMessage, review } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { ATS_LABEL } from "../apply/format";
import { checkboxClass } from "../kb/format";

const MAX_BATCH = 50;

export const platformName = (kind: string | null) => (kind ? (ATS_LABEL[kind as AtsKind] ?? kind) : "plataforma desconhecida");

/** "Gupy: 3 hoje" / "LinkedIn: 2 hoje, 3 em +2 dias" / "limite diário 0: não envia". */
export function estimateLine(p: SendEstimate["perPlatform"][number]): string {
  const name = platformName(p.kind);
  if (p.days < 0) return `${name}: ${p.count} — limite diário 0: não envia`;
  const today = Math.min(p.count, Math.max(0, p.remainingToday));
  const rest = p.count - today;
  const parts: string[] = [];
  if (today > 0) parts.push(`${today} hoje${p.minutes > 0 ? ` (~${p.minutes} min)` : ""}`);
  if (rest > 0) parts.push(`${rest} em +${p.days} ${p.days === 1 ? "dia" : "dias"}`);
  return `${name}: ${parts.join(", ")}`;
}

/** Batch approval for the "Prontas" tab: estimate per platform first, then the real approval (F5 endpoint). */
export function ApproveBar({
  items,
  allIds,
  dryRun,
  onSelectAll,
  onDone,
}: {
  items: ReviewItem[];
  allIds: string[];
  dryRun: boolean;
  onSelectAll: (ids: string[]) => void;
  onDone: (res: ApproveBatchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [estimate, setEstimate] = useState<SendEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const allSelected = allIds.length > 0 && items.length === allIds.length;
  const tooMany = items.length > MAX_BATCH;

  async function openDialog() {
    setEstimate(null);
    setOpen(true);
    setEstimating(true);
    try {
      setEstimate(await review.estimate(items.map((i) => i.applicationId)));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setEstimating(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const res = await applications.approveBatch(items.map((i) => i.applicationId));
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
        <input type="checkbox" className={checkboxClass} checked={allSelected} onChange={(e) => onSelectAll(e.target.checked ? allIds : [])} />
        Selecionar todas
      </label>
      {dryRun && (
        <span className="text-muted-foreground text-xs">
          Modo Simulação: nada é enviado. Mude para Revisão em{" "}
          <Link href="/vagas/preferencias" className="underline">
            Preferências
          </Link>
          .
        </span>
      )}
      {tooMany && <span className="text-destructive text-xs">Máximo de {MAX_BATCH} por vez.</span>}
      <Button className="ml-auto" disabled={items.length === 0 || dryRun || tooMany || busy} onClick={() => void openDialog()}>
        Aprovar selecionadas ({items.length})
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Enviar ${items.length} candidatura(s) de verdade?`}
        confirmLabel="Sim, enviar todas"
        busy={busy}
        disabled={estimating}
        onConfirm={() => void approve()}
      >
        <div className="space-y-1 rounded-lg border p-2 text-sm">
          <p className="font-medium">Previsão de envio (limites diários)</p>
          {estimating && <p className="text-muted-foreground">Calculando…</p>}
          {estimate && (
            <ul className="space-y-0.5">
              {estimate.perPlatform.map((p) => (
                <li key={p.kind}>{estimateLine(p)}</li>
              ))}
            </ul>
          )}
        </div>
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm">
          {items.map((i) => (
            <li key={i.applicationId}>
              <span className="font-medium">{i.title}</span>
              <span className="text-muted-foreground"> · {i.company || "empresa não informada"}</span>
            </li>
          ))}
        </ul>
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm font-medium">
          Estas candidaturas serão ENVIADAS DE VERDADE para as empresas com as respostas e o currículo mostrados na página de cada uma.
        </p>
      </ConfirmDialog>
    </div>
  );
}
