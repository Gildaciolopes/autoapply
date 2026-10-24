"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MemoryView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiRequestError, errorMessage, memories } from "@/lib/api";
import { ConfirmDialog } from "../apply/confirm-dialog";
import { fmtDateTime, textareaClass } from "../kb/format";
import { useLoad } from "../kb/use-load";

const ORIGIN_LABEL: Record<string, string> = { needs_input: "Pendência", inline: "Revisão", edit: "Edição" };

/** `/memoria` (F6 T025): answers the user gave or corrected, reused for equal questions. */
export function MemoriesView() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, setData, loading } = useLoad(() => memories.list({ q: query || undefined }), query);
  const replace = (m: MemoryView) => setData((prev) => prev?.map((x) => (x.id === m.id ? m : x)));
  const [deleting, setDeleting] = useState<MemoryView | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(m: MemoryView, enabled: boolean) {
    try {
      replace(await memories.patch(m.id, { enabled }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await memories.remove(deleting.id);
      setData((prev) => prev?.filter((x) => x.id !== deleting.id));
      toast.success("Resposta apagada");
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Respostas que você deu ou corrigiu. São reaproveitadas em perguntas iguais; um fato verificado sempre vence.
      </p>
      <Input aria-label="Buscar" placeholder="Buscar pergunta ou resposta…" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />

      {loading && !data && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {data && data.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma resposta salva{query ? " para essa busca" : ""}.</p>}
      {data && data.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pergunta</TableHead>
                <TableHead>Resposta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Usos</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead>Ativa</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id} className={m.enabled ? undefined : "opacity-60"}>
                  <TableCell className="max-w-xs align-top whitespace-normal">{m.question}</TableCell>
                  <TableCell className="max-w-sm align-top whitespace-normal">
                    <AnswerCell memory={m} onSaved={replace} />
                    {m.conflict && (
                      <div className="mt-1 space-y-0.5" title={m.conflict}>
                        <Badge className="bg-orange-500/20 text-orange-800 dark:text-orange-400">diverge do fato</Badge>
                        <p className="text-muted-foreground text-xs">{m.conflict}</p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">{m.fieldType ?? "—"}</TableCell>
                  <TableCell className="align-top">{ORIGIN_LABEL[m.origin] ?? m.origin}</TableCell>
                  <TableCell className="text-right align-top">{m.usedCount}</TableCell>
                  <TableCell className="align-top">{fmtDateTime(m.lastUsedAt)}</TableCell>
                  <TableCell className="align-top">
                    <Switch checked={m.enabled} aria-label="Ativa" onCheckedChange={(v) => void toggle(m, v)} />
                  </TableCell>
                  <TableCell className="align-top">
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(m)}>
                      Apagar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Apagar esta resposta salva?"
        confirmLabel="Apagar"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
      >
        <p className="text-sm">{deleting?.question}</p>
        <p className="text-muted-foreground text-sm">Perguntas iguais deixam de usar esta resposta.</p>
      </ConfirmDialog>
    </div>
  );
}

function AnswerCell({ memory, onSaved }: { memory: MemoryView; onSaved: (m: MemoryView) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.answer);
  const [saving, setSaving] = useState(false);

  async function save() {
    const answer = value.trim();
    if (!answer) {
      toast.error("A resposta não pode ficar vazia");
      return;
    }
    setSaving(true);
    try {
      onSaved(await memories.patch(memory.id, { answer }));
      setEditing(false);
      toast.success("Resposta atualizada");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="hover:bg-muted/60 -mx-1 rounded px-1 text-left"
        title="Clique para editar"
        onClick={() => {
          setValue(memory.answer);
          setEditing(true);
        }}
      >
        {memory.answer}
      </button>
    );
  }
  return (
    <div className="space-y-1.5">
      <textarea aria-label="Resposta" className={textareaClass} value={value} maxLength={2000} onChange={(e) => setValue(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
