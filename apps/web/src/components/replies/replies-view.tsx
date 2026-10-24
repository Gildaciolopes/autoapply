"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationListItem, ReplyPatchBody, ReplyType, ReplyView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiRequestError, applications, errorMessage, replies } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { fmtDateTime, nativeSelectClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { REPLY_TYPE_LABELS, REPLY_TYPES, ReplyTypeBadge, fmtConfidence } from "./format";

const ORIGIN_LABEL: Record<ReplyView["origin"], string> = { email: "email", manual: "manual" };

/** Applications a reply can be relinked to (the API refuses anything else with 409 `not_submitted`). */
async function loadTargets(): Promise<ApplicationListItem[]> {
  const lists = await Promise.all([applications.list("submitted"), applications.list("submit_uncertain"), applications.list("already_applied")]);
  return lists.flat();
}

/** `/respostas` (F7 T019): company replies found in Gmail or recorded by hand; uncertain ones first. */
export function RepliesView() {
  const { data, setData, loading } = useLoad(async () => {
    const [items, targets] = await Promise.all([replies.list(), loadTargets()]);
    return { items, targets };
  });
  const [deleting, setDeleting] = useState<ReplyView | null>(null);
  const [busy, setBusy] = useState(false);

  const replace = (r: ReplyView) => setData((prev) => prev && { ...prev, items: prev.items.map((x) => (x.id === r.id ? r : x)) });

  async function patch(r: ReplyView, body: ReplyPatchBody, done?: string) {
    try {
      replace(await replies.patch(r.id, body));
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.code === "not_submitted" ? "Essa candidatura ainda não foi enviada" : errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await replies.remove(deleting.id);
      setData((prev) => prev && { ...prev, items: prev.items.filter((x) => x.id !== deleting.id) });
      toast.success("Resposta apagada");
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const review = data?.items.filter((r) => r.needsReview) ?? [];
  const rest = data?.items.filter((r) => !r.needsReview) ?? [];

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Respostas das empresas às suas candidaturas, lidas do Gmail (somente leitura) ou registradas por você na página da candidatura.{" "}
        <Link href="/integracoes" className="underline">
          Integrações
        </Link>
      </p>

      {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && data.items.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma resposta ainda.</p>}

      {review.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Verificar ({review.length})</h2>
          <p className="text-muted-foreground text-xs">Não temos certeza do tipo ou da candidatura. Confira e corrija se preciso.</p>
          <ul className="divide-y rounded-lg border border-amber-500/50">
            {review.map((r) => (
              <ReplyRow key={r.id} reply={r} targets={data?.targets ?? []} onPatch={patch} onDelete={setDeleting} />
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{review.length > 0 ? `Demais respostas (${rest.length})` : `Todas (${rest.length})`}</h2>
          <ul className="divide-y rounded-lg border">
            {rest.map((r) => (
              <ReplyRow key={r.id} reply={r} targets={data?.targets ?? []} onPatch={patch} onDelete={setDeleting} />
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Apagar esta resposta?"
        confirmLabel="Apagar"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
      >
        <p className="text-sm">
          {deleting?.title} — {deleting?.company}
          {deleting?.subject && <span className="text-muted-foreground"> · {deleting.subject}</span>}
        </p>
        <p className="text-muted-foreground text-sm">O resultado da candidatura é recalculado. O email não volta a ser importado.</p>
      </ConfirmDialog>
    </div>
  );
}

function ReplyRow({
  reply: r,
  targets,
  onPatch,
  onDelete,
}: {
  reply: ReplyView;
  targets: ApplicationListItem[];
  onPatch: (r: ReplyView, body: ReplyPatchBody, done?: string) => Promise<void>;
  onDelete: (r: ReplyView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (body: ReplyPatchBody, done?: string) => {
    setBusy(true);
    await onPatch(r, body, done);
    setBusy(false);
  };
  const others = targets.filter((a) => a.id !== r.applicationId);

  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/vagas/${r.jobId}/candidatura`} className="font-medium hover:underline">
          {r.title} — {r.company || "empresa não informada"}
        </Link>
        <ReplyTypeBadge type={r.type} />
        <Badge variant="outline">{ORIGIN_LABEL[r.origin]}</Badge>
        {r.userEdited && <Badge variant="secondary">corrigida por você</Badge>}
        <span className="text-muted-foreground ml-auto text-xs">{fmtDateTime(r.receivedAt)}</span>
      </div>
      {(r.sender || r.subject) && (
        <p>
          {r.sender && <span className="text-muted-foreground">{r.sender}</span>}
          {r.sender && r.subject && " · "}
          {r.subject && <span className="font-medium">{r.subject}</span>}
        </p>
      )}
      {r.excerpt && <p className="text-muted-foreground whitespace-pre-line">{r.excerpt}</p>}
      {r.note && <p className="whitespace-pre-line">Nota: {r.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {r.origin === "email" && <span className="text-muted-foreground text-xs">confiança {fmtConfidence(r.confidence)}</span>}
        {r.link && (
          <a href={r.link} target="_blank" rel="noreferrer" className="text-muted-foreground text-xs hover:underline">
            Abrir no Gmail ↗
          </a>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            aria-label="Tipo"
            className={nativeSelectClass}
            disabled={busy}
            value={r.type}
            onChange={(e) => void run({ type: e.target.value as ReplyType }, "Tipo atualizado")}
          >
            {REPLY_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPLY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {others.length > 0 && (
            <select
              aria-label="Mover para outra candidatura"
              className={`${nativeSelectClass} max-w-64`}
              disabled={busy}
              value=""
              onChange={(e) => e.target.value && void run({ applicationId: e.target.value }, "Resposta movida")}
            >
              <option value="">Mover para…</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.jobTitle} — {a.company || "empresa não informada"}
                </option>
              ))}
            </select>
          )}
          {r.needsReview && (
            <Button size="sm" disabled={busy} onClick={() => void run({ needsReview: false }, "Confirmada")}>
              Está certo
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => onDelete(r)}>
            Apagar
          </Button>
        </div>
      </div>
    </li>
  );
}
