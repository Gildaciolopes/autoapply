"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ReviewItem } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applications, errorMessage, review } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { NeedsInputForm } from "../apply/needs-input-form";
import { scoreClass } from "../jobs/format";
import { checkboxClass, fmtDateTime, textareaClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { platformName } from "./approve-bar";

/** Groups whose applications the API lets the user reject (approved/submitting/uncertain are 409 `not_rejectable`). */
const REJECTABLE = new Set<ReviewItem["group"]>(["ready", "needs_input", "failed"]);

export function ReviewRow({
  item,
  selectable,
  selected,
  onSelect,
  onChanged,
}: {
  item: ReviewItem;
  selectable: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChanged: () => void;
}) {
  const [answering, setAnswering] = useState(false);
  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${item.title}`}
            className={checkboxClass}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
          />
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/vagas/${item.jobId}/candidatura`} className="font-medium hover:underline">
            {item.title}
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            {[item.company || "empresa não informada", platformName(item.platform), `atualizada ${fmtDateTime(item.updatedAt)}`].join(" · ")}
          </p>
          {item.reason && <p className="text-muted-foreground text-xs">{item.reason}</p>}
        </div>
        {item.lowConfidence > 0 && (
          <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-400">
            {item.lowConfidence} {item.lowConfidence === 1 ? "resposta" : "respostas"} com baixa confiança
          </Badge>
        )}
        {item.score !== null && <Badge className={scoreClass(item.score)}>{Math.round(item.score)}</Badge>}
        {item.group === "needs_input" && (
          <Button size="sm" variant="outline" onClick={() => setAnswering((v) => !v)}>
            {answering ? "Fechar" : "Responder"}
          </Button>
        )}
        {REJECTABLE.has(item.group) && <RejectButton item={item} onDone={onChanged} />}
      </div>
      {item.group === "needs_input" && !answering && item.needsQuestions.length > 0 && (
        <ul className="text-muted-foreground list-disc pl-5 text-xs">
          {item.needsQuestions.map((q, i) => (
            <li key={`${q}-${i}`}>{q}</li>
          ))}
        </ul>
      )}
      {answering && <InlineAnswers applicationId={item.applicationId} onSaved={onChanged} />}
    </li>
  );
}

/** Inline needs-input answers from the review queue (memory origin `inline`, re-prepares the application). */
function InlineAnswers({ applicationId, onSaved }: { applicationId: string; onSaved: () => void }) {
  const { data: app } = useLoad(() => applications.get(applicationId), applicationId);
  if (!app) return <p className="text-muted-foreground text-xs">Carregando perguntas…</p>;
  const blocking = app.answers.filter((a) => a.blocking);
  const last = [...app.artifacts].reverse().find((a) => a.label === "last");
  return (
    <NeedsInputForm
      app={app}
      blocking={blocking}
      lastShotUrl={last ? applications.artifactUrl(app.id, last.id) : null}
      from="review"
      onSaved={() => onSaved()}
    />
  );
}

function RejectButton({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();

  async function reject() {
    setBusy(true);
    try {
      await review.reject(item.applicationId, trimmed);
      toast.success("Candidatura rejeitada");
      setOpen(false);
      setReason("");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        Rejeitar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Rejeitar esta candidatura?"
        confirmLabel="Rejeitar"
        destructive
        busy={busy}
        disabled={trimmed.length === 0 || trimmed.length > 300}
        onConfirm={() => void reject()}
      >
        <p className="text-sm">
          {item.title} · {item.company || "empresa não informada"}
        </p>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Motivo (obrigatório)</span>
          <textarea className={textareaClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
      </ConfirmDialog>
    </>
  );
}
