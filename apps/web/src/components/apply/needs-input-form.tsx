"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationView, FormAnswerView } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiRequestError, applications, errorMessage } from "@/lib/api";
import { checkboxClass, nativeSelectClass, textareaClass } from "../kb/format";
import { ReasonChip } from "./badges";
import { MANUAL_REASONS } from "./format";

const MULTI_SEP = "; ";

/** Blocking questions the engine could not answer from verified data; answers are saved as approved memory. */
export function NeedsInputForm({
  app,
  blocking,
  lastShotUrl,
  onSaved,
}: {
  app: ApplicationView;
  blocking: FormAnswerView[];
  lastShotUrl: string | null;
  onSaved: (v: ApplicationView) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const manual = app.reasonCodes.filter((c) => MANUAL_REASONS.has(c));
  const editable = blocking.filter((a) => a.fieldType !== "file");

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  async function save() {
    const answers = editable.map((a) => ({ fieldKey: a.fieldKey, answer: (values[a.fieldKey] ?? "").trim() })).filter((a) => a.answer);
    if (answers.length === 0) {
      toast.error("Responda ao menos uma pergunta");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await applications.answers(app.id, { answers, rerun: true }));
      setValues({});
      toast.success("Respostas salvas — nova simulação em fila");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422) setError(err.message);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle className="text-base">Precisa de você</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {manual.length > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="flex flex-wrap gap-1">
              {manual.map((c) => (
                <ReasonChip key={c} code={c} />
              ))}
            </div>
            <p>Não resolvemos captcha — abra a vaga e conclua manualmente quando o envio real existir.</p>
            {lastShotUrl && (
              <a href={lastShotUrl} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                {/* eslint-disable-next-line @next/next/no-img-element -- API-served PNG, not optimizable */}
                <img src={lastShotUrl} alt="Última tela" className="max-h-96 rounded-md border object-contain object-top" />
              </a>
            )}
          </div>
        )}

        {editable.length > 0 && (
          <>
            <p className="text-muted-foreground text-xs">
              Suas respostas ficam salvas como &quot;Resposta salva&quot; e são reutilizadas em outras vagas com a mesma pergunta.
            </p>
            {error && <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3">{error}</div>}
            {editable.map((a) => (
              <div key={a.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`ans-${a.id}`} className="font-medium">
                    {a.question}
                    {a.required && <span className="text-destructive"> *</span>}
                  </label>
                  {a.reason && <ReasonChip code={a.reason} />}
                </div>
                <AnswerInput field={a} value={values[a.fieldKey] ?? ""} onChange={(v) => set(a.fieldKey, v)} />
              </div>
            ))}
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Salvando…" : "Salvar e simular de novo"}
            </Button>
          </>
        )}

        {blocking.some((a) => a.fieldType === "file") && (
          <p className="text-muted-foreground text-xs">
            Campos de anexo usam o currículo/carta adaptados — revise-os na página do currículo da vaga.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AnswerInput({ field, value, onChange }: { field: FormAnswerView; value: string; onChange: (v: string) => void }) {
  const id = `ans-${field.id}`;
  const { fieldType: type, options } = field;

  if ((type === "select" || type === "radio") && options.length > 0) {
    return (
      <select id={id} className={`${nativeSelectClass} w-full max-w-md`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— escolha —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (type === "checkbox" && options.length > 0) {
    const selected = value ? value.split(MULTI_SEP) : [];
    const toggle = (o: string, on: boolean) => {
      const next = on ? [...selected, o] : selected.filter((x) => x !== o);
      onChange(options.filter((x) => next.includes(x)).join(MULTI_SEP));
    };
    return (
      <div id={id} className="space-y-1">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input type="checkbox" className={checkboxClass} checked={selected.includes(o)} onChange={(e) => toggle(o, e.target.checked)} />
            {o}
          </label>
        ))}
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <select id={id} className={nativeSelectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— escolha —</option>
        <option value="true">Sim (marcar)</option>
        <option value="false">Não (deixar desmarcado)</option>
      </select>
    );
  }

  return <textarea id={id} className={textareaClass} value={value} onChange={(e) => onChange(e.target.value)} />;
}
