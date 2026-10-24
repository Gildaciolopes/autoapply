"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationView, ReplyType } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiRequestError, errorMessage, replies } from "@/lib/api";
import { fmtDateTime, nativeSelectClass, textareaClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { REPLY_TYPE_LABELS, REPLY_TYPES, REPLYABLE, ReplyTypeBadge } from "./format";

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** "Respostas" timeline on the application page (F7 T019) + manual reply form for sent applications. */
export function ApplicationReplies({ app, onChanged }: { app: ApplicationView; onChanged: () => void }) {
  const { data, setData, loading } = useLoad(() => replies.forApplication(app.id), app.id);
  const canRecord = REPLYABLE.has(app.status);
  if (!canRecord && (data?.length ?? 0) === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Respostas{data && data.length > 0 ? ` (${data.length})` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading && !data && <p className="text-muted-foreground">Carregando…</p>}
        {data && data.length === 0 && <p className="text-muted-foreground">Nenhuma resposta da empresa ainda.</p>}
        {data && data.length > 0 && (
          <ol className="space-y-3 border-l pl-4">
            {data.map((r) => (
              <li key={r.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">{fmtDateTime(r.receivedAt)}</span>
                  <ReplyTypeBadge type={r.type} />
                  <Badge variant="outline">{r.origin === "email" ? "email" : "manual"}</Badge>
                  {r.needsReview && (
                    <Link href="/respostas">
                      <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-400">verificar</Badge>
                    </Link>
                  )}
                </div>
                {r.subject && (
                  <p>
                    {r.sender && <span className="text-muted-foreground">{r.sender} · </span>}
                    <span className="font-medium">{r.subject}</span>
                  </p>
                )}
                {r.excerpt && <p className="text-muted-foreground whitespace-pre-line">{r.excerpt}</p>}
                {r.note && <p className="whitespace-pre-line">{r.note}</p>}
                {r.link && (
                  <a href={r.link} target="_blank" rel="noreferrer" className="text-muted-foreground text-xs hover:underline">
                    Abrir no Gmail ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
        {canRecord && (
          <ManualReplyForm
            appId={app.id}
            onSaved={(r) => {
              setData((prev) => [r, ...(prev ?? [])].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
              onChanged();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ManualReplyForm({ appId, onSaved }: { appId: string; onSaved: (r: Awaited<ReturnType<typeof replies.create>>) => void }) {
  const [type, setType] = useState<ReplyType>("interview");
  const [at, setAt] = useState(localNow);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) {
      toast.error("Informe data e hora");
      return;
    }
    setBusy(true);
    try {
      onSaved(await replies.create(appId, { type, receivedAt: d.toISOString(), note: note.trim() || undefined }));
      setNote("");
      toast.success("Resposta registrada");
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.code === "not_submitted" ? "Só dá para registrar resposta de candidatura enviada" : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">Registrar resposta</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Tipo" className={nativeSelectClass} value={type} onChange={(e) => setType(e.target.value as ReplyType)}>
          {REPLY_TYPES.map((t) => (
            <option key={t} value={t}>
              {REPLY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <Input aria-label="Data e hora" type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <textarea
        aria-label="Nota"
        placeholder="Nota (opcional)"
        className={textareaClass}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Salvando…" : "Registrar"}
        </Button>
        <span className="text-muted-foreground text-xs">{note.length}/500</span>
      </div>
    </div>
  );
}
