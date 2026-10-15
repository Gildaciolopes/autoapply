"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ConflictView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { conflicts, errorMessage, type ResolveBody } from "@/lib/api";
import { KIND_LABEL, fmtDateTime, originLabel, summarizeValue, textareaClass } from "./format";
import { useLoad } from "./use-load";

const TYPE_LABEL = { value_mismatch: "Valores diferentes", possible_duplicate: "Possível duplicata" } as const;

export function ConflictsView() {
  const { data, loading, reload } = useLoad(() => conflicts.list("open"));
  if (!data) return <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Não foi possível carregar."}</p>;
  if (data.length === 0) return <p className="text-muted-foreground text-sm">Nenhum conflito aberto.</p>;
  return (
    <div className="space-y-4">
      {data.map((c) => (
        <ConflictCard key={c.id} conflict={c} onResolved={() => reload(true)} />
      ))}
    </div>
  );
}

function ConflictCard({ conflict: c, onResolved }: { conflict: ConflictView; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function resolve(body: ResolveBody) {
    setBusy(true);
    try {
      await conflicts.resolve(c.id, body);
      toast.success("Conflito resolvido");
      onResolved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submitEdit() {
    if (editing === null) return;
    let value: unknown;
    try {
      value = JSON.parse(editing);
    } catch {
      toast.error("JSON inválido");
      return;
    }
    void resolve({ strategy: "edit", value });
  }

  const mismatch = c.type === "value_mismatch";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{KIND_LABEL[c.kind]}</CardTitle>
          <Badge variant={mismatch ? "destructive" : "secondary"}>{TYPE_LABEL[c.type]}</Badge>
          <span className="text-muted-foreground font-mono text-xs break-all">{c.key}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {c.candidates.map((cand, i) => (
            <div key={`${cand.origin}-${cand.ref}-${i}`} className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{originLabel(cand.origin)}</Badge>
                <span className="text-muted-foreground font-mono text-xs break-all">{cand.ref}</span>
              </div>
              <p className="font-medium">{summarizeValue(c.kind, cand.value)}</p>
              <p className="text-muted-foreground text-xs">importado {fmtDateTime(cand.importedAt)}</p>
              {mismatch && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => resolve({ strategy: "choose", chosenIndex: i })}>
                    Escolher
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(JSON.stringify(cand.value, null, 2))}>
                    Editar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {editing !== null && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">Edite o valor final (JSON) e salve.</p>
            <textarea className={`${textareaClass} min-h-40 font-mono text-xs`} value={editing} onChange={(e) => setEditing(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={submitEdit}>
                Salvar edição
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {mismatch ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ strategy: "split" })}>
              São itens diferentes
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={() => resolve({ strategy: "merge" })}>
                Mesclar
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ strategy: "keep_separate" })}>
                Manter separados
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
