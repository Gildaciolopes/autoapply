"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { DraftSection, LooseDate, ResumeDetail, ResumeDiff, ResumeDraft } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiRequestError, errorMessage, resumes } from "@/lib/api";
import { fmtDateTime, summarizeValue, textareaClass } from "./format";
import { LooseDateInput } from "./loose-date-input";
import { RESUME_STATUS, isProcessing } from "./resume-list";
import { useLoad } from "./use-load";

export function ResumeDetailView() {
  const { id } = useParams<{ id: string }>();
  const { data, setData, loading, reload } = useLoad(() => resumes.get(id), id, {
    pollMs: 3000,
    shouldPoll: (d) => isProcessing(d.status),
  });

  if (!data) return <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Currículo não encontrado."}</p>;

  const st = RESUME_STATUS[data.status];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/conhecimento/curriculo" className="text-muted-foreground text-sm hover:underline">
          ← Currículos
        </Link>
        <h2 className="text-lg font-semibold">{data.fileName}</h2>
        <Badge variant={st.variant}>{st.label}</Badge>
        <span className="text-muted-foreground text-sm">
          v{data.version} · {fmtDateTime(data.createdAt)}
        </span>
      </div>

      {isProcessing(data.status) && (
        <Card>
          <CardContent className="text-sm">Extraindo dados do PDF com o modelo local… esta página atualiza sozinha.</CardContent>
        </Card>
      )}
      {(data.status === "failed" || data.status === "image_only") && <RetryPanel detail={data} onDone={() => reload(true)} />}
      {data.status === "review" && data.draft && (
        <DraftEditor key={data.id} detail={data} draft0={data.draft} onDetail={setData} onDone={() => reload(true)} />
      )}
      {data.status === "confirmed" && (
        <Card>
          <CardContent className="space-y-2 text-sm">
            <p>
              Currículo confirmado em {fmtDateTime(data.confirmedAt)}. Os itens viraram fatos verificados na base.
            </p>
            <Link href="/conhecimento/fatos?origin=resume" className="text-primary hover:underline">
              Ver fatos vindos do currículo →
            </Link>
          </CardContent>
        </Card>
      )}
      {data.status === "discarded" && (
        <Card>
          <CardContent className="text-muted-foreground text-sm">Este currículo foi descartado.</CardContent>
        </Card>
      )}
    </div>
  );
}

function RetryPanel({ detail, onDone }: { detail: ResumeDetail; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <p>
          {detail.status === "image_only"
            ? "O PDF parece ser só imagem (sem texto selecionável). Você pode tentar a extração com visão (OCR local) ou preencher manualmente."
            : "A extração falhou."}
        </p>
        {detail.error && <p className="text-destructive">{detail.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => act(() => resumes.retry(detail.id, "vision"))}>
            Tentar com visão (OCR local)
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => act(() => resumes.retry(detail.id, "text"))}>
            Tentar novamente
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => act(() => resumes.manual(detail.id))}>
            Preencher manualmente
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- draft editor ----------

type Item = { id: string; quote: string; flags: string[] } & Record<string, unknown>;
type FieldType = "text" | "textarea" | "lines" | "comma" | "date";
interface Field {
  key: string;
  label: string;
  type: FieldType;
}

const SECTIONS: { key: DraftSection; title: string; prefix: string; fields: Field[]; blank: Record<string, unknown> }[] = [
  {
    key: "work",
    title: "Experiência",
    prefix: "work",
    fields: [
      { key: "name", label: "Empresa", type: "text" },
      { key: "position", label: "Cargo", type: "text" },
      { key: "location", label: "Local", type: "text" },
      { key: "startDate", label: "Início", type: "date" },
      { key: "endDate", label: "Fim", type: "date" },
      { key: "highlights", label: "Destaques (um por linha)", type: "lines" },
    ],
    blank: { name: "", position: "", startDate: null, endDate: null, highlights: [] },
  },
  {
    key: "education",
    title: "Formação",
    prefix: "education",
    fields: [
      { key: "institution", label: "Instituição", type: "text" },
      { key: "studyType", label: "Grau", type: "text" },
      { key: "area", label: "Área", type: "text" },
      { key: "startDate", label: "Início", type: "date" },
      { key: "endDate", label: "Fim", type: "date" },
    ],
    blank: { institution: "", startDate: null, endDate: null },
  },
  {
    key: "skills",
    title: "Skills",
    prefix: "skills",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "category", label: "Categoria", type: "text" },
    ],
    blank: { name: "" },
  },
  {
    key: "languages",
    title: "Idiomas",
    prefix: "languages",
    fields: [
      { key: "language", label: "Idioma", type: "text" },
      { key: "fluency", label: "Fluência", type: "text" },
    ],
    blank: { language: "" },
  },
  {
    key: "certificates",
    title: "Certificações",
    prefix: "certificates",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "issuer", label: "Emissor", type: "text" },
      { key: "date", label: "Data", type: "date" },
    ],
    blank: { name: "", date: null },
  },
  {
    key: "projects",
    title: "Projetos",
    prefix: "projects",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "url", label: "URL", type: "text" },
      { key: "highlights", label: "Destaques (um por linha)", type: "lines" },
      { key: "keywords", label: "Palavras-chave (separadas por vírgula)", type: "comma" },
    ],
    blank: { name: "", highlights: [], keywords: [] },
  },
];

function itemLabel(section: DraftSection, it: Record<string, unknown>): string {
  const s = (k: string) => (typeof it[k] === "string" ? (it[k] as string) : "");
  switch (section) {
    case "work":
      return `${s("position")} — ${s("name")}`;
    case "education":
      return s("institution");
    case "languages":
      return s("language");
    default:
      return s("name");
  }
}

function findItem(draft: ResumeDraft, id: string): { section: DraftSection; item: Record<string, unknown> } | null {
  for (const s of SECTIONS) {
    const item = (draft[s.key] as Item[]).find((i) => i.id === id);
    if (item) return { section: s.key, item };
  }
  return null;
}

/** Guess a kind from the value's shape to summarize diff entries. */
function summarizeAny(v: unknown): string {
  if (!v || typeof v !== "object") return String(v ?? "");
  const o = v as Record<string, unknown>;
  const kind = "company" in o ? "experience" : "institution" in o ? "education" : "language" in o ? "language" : "label" in o ? "metric" : "skill";
  return summarizeValue(kind, v);
}

function DraftEditor({
  detail,
  draft0,
  onDetail,
  onDone,
}: {
  detail: ResumeDetail;
  draft0: ResumeDraft;
  onDetail: (d: ResumeDetail) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ResumeDraft>(draft0);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [unresolved, setUnresolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  const setBasics = (k: string, v: string) => setDraft((d) => ({ ...d, basics: { ...d.basics, [k]: v } }));

  function updateItem(section: DraftSection, id: string, patch: Record<string, unknown>) {
    setDraft((d) => ({ ...d, [section]: (d[section] as Item[]).map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }
  function removeItem(section: DraftSection, id: string) {
    setDraft((d) => ({ ...d, [section]: (d[section] as Item[]).filter((i) => i.id !== id) }));
    setKept((k) => new Set([...k].filter((x) => x !== id)));
  }
  function addItem(section: (typeof SECTIONS)[number]) {
    const n = counter + 1;
    setCounter(n);
    const item = { id: `${section.prefix}-new-${n}`, quote: "", flags: [], ...section.blank };
    setDraft((d) => ({ ...d, [section.key]: [...(d[section.key] as Item[]), item] }));
  }

  async function save(): Promise<ResumeDetail | null> {
    try {
      const next = await resumes.saveDraft(detail.id, draft);
      if (next.draft) setDraft(next.draft);
      onDetail(next);
      return next;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  }

  async function onSave() {
    setBusy("save");
    if (await save()) toast.success("Rascunho salvo");
    setBusy(null);
  }

  async function onConfirm() {
    setBusy("confirm");
    try {
      // Persist edits first so the server confirms exactly what the user sees.
      const saved = await save();
      if (!saved) return;
      const r = await resumes.confirm(detail.id, [...kept]);
      toast.success(`Confirmado: ${r.created} criados, ${r.updated} atualizados, ${r.conflicts} conflitos`);
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "unresolved_flags" && Array.isArray(err.details)) {
        setUnresolved(new Set(err.details as string[]));
      }
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onDiscard() {
    if (!window.confirm("Descartar este currículo? Nada será importado.")) return;
    setBusy("discard");
    try {
      await resumes.discard(detail.id);
      toast.success("Currículo descartado");
      router.push("/conhecimento/curriculo");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const basicsFields: [string, string][] = [
    ["name", "Nome"],
    ["headline", "Título"],
    ["email", "E-mail"],
    ["phone", "Telefone"],
    ["location", "Localização"],
    ["url", "Site"],
  ];

  return (
    <div className="space-y-4">
      {detail.diff && <DiffPanel diff={detail.diff} draft={draft} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <iframe
            src={resumes.fileUrl(detail.id)}
            title="PDF original"
            className="h-[80vh] w-full rounded-xl border"
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados básicos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {basicsFields.map(([k, label]) => (
                <label key={k} className="space-y-1 text-sm">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <Input
                    value={(draft.basics as Record<string, unknown>)[k] as string | undefined ?? ""}
                    onChange={(e) => setBasics(k, e.target.value)}
                  />
                </label>
              ))}
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground text-xs">Resumo</span>
                <textarea
                  className={textareaClass}
                  value={draft.basics.summary ?? ""}
                  onChange={(e) => setBasics("summary", e.target.value)}
                />
              </label>
            </CardContent>
          </Card>

          {SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{section.title}</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => addItem(section)}>
                    + Adicionar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {(draft[section.key] as Item[]).length === 0 && <p className="text-muted-foreground text-sm">Nenhum item.</p>}
                {(draft[section.key] as Item[]).map((item) => (
                  <ItemEditor
                    key={item.id}
                    item={item}
                    fields={section.fields}
                    kept={kept.has(item.id)}
                    unresolved={unresolved.has(item.id)}
                    onChange={(patch) => updateItem(section.key, item.id, patch)}
                    onRemove={() => removeItem(section.key, item.id)}
                    onKeep={(keep) => {
                      setKept((k) => {
                        const n = new Set(k);
                        if (keep) n.add(item.id);
                        else n.delete(item.id);
                        return n;
                      });
                      if (keep) setUnresolved((u) => new Set([...u].filter((x) => x !== item.id)));
                    }}
                  />
                ))}
              </CardContent>
            </Card>
          ))}

          <div className="bg-background/95 sticky bottom-0 flex flex-wrap gap-2 border-t py-3">
            <Button variant="outline" disabled={busy !== null} onClick={onSave}>
              {busy === "save" ? "Salvando…" : "Salvar rascunho"}
            </Button>
            <Button disabled={busy !== null} onClick={onConfirm}>
              {busy === "confirm" ? "Confirmando…" : "Confirmar"}
            </Button>
            <Button variant="destructive" disabled={busy !== null} onClick={onDiscard}>
              Descartar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  fields,
  kept,
  unresolved,
  onChange,
  onRemove,
  onKeep,
}: {
  item: Item;
  fields: Field[];
  kept: boolean;
  unresolved: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onKeep: (keep: boolean) => void;
}) {
  const notInSource = item.flags.includes("not_in_source");
  const ambiguous = item.flags.includes("date_ambiguous");
  const flagged = notInSource && !kept;
  const border = unresolved
    ? "border-destructive ring-2 ring-destructive/30"
    : flagged
      ? "border-amber-400 bg-amber-50/60 dark:border-amber-600 dark:bg-amber-950/30"
      : "";

  return (
    <div className={`space-y-2 rounded-lg border p-3 ${border}`}>
      {notInSource && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {kept ? (
            <>
              <Badge variant="outline">mantido mesmo sem estar no PDF</Badge>
              <Button size="xs" variant="ghost" onClick={() => onKeep(false)}>
                desfazer
              </Button>
            </>
          ) : (
            <>
              <span className="font-medium text-amber-800 dark:text-amber-300">Não encontrado no PDF</span>
              <Button size="xs" variant="destructive" onClick={onRemove}>
                Remover
              </Button>
              <Button size="xs" variant="outline" onClick={() => onKeep(true)}>
                Manter mesmo assim
              </Button>
            </>
          )}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className={`space-y-1 text-sm ${f.type === "lines" || f.type === "textarea" || f.type === "comma" ? "sm:col-span-2" : ""}`}>
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              {f.label}
              {f.type === "date" && ambiguous && (
                <Badge variant="secondary" className="h-4 text-[10px]">
                  data ambígua
                </Badge>
              )}
            </span>
            <FieldInput field={f} value={item[f.key]} onChange={(v) => onChange({ [f.key]: v })} />
          </label>
        ))}
      </div>
      {item.quote && <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">“{item.quote}”</p>}
      <div className="flex justify-end">
        <Button size="xs" variant="ghost" onClick={onRemove}>
          Remover item
        </Button>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case "date":
      return <LooseDateInput value={value as LooseDate | null | undefined} onChange={onChange} allowPresent={field.key === "endDate"} />;
    case "lines":
      return (
        <textarea
          className={textareaClass}
          value={((value as string[] | undefined) ?? []).join("\n")}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          onBlur={(e) => onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
        />
      );
    case "comma":
      return (
        <Input
          value={((value as string[] | undefined) ?? []).join(", ")}
          onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trimStart()))}
          onBlur={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      );
    case "textarea":
      return <textarea className={textareaClass} value={(value as string | undefined) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input value={(value as string | undefined) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

function DiffPanel({ diff, draft }: { diff: ResumeDiff; draft: ResumeDraft }) {
  if (!diff.added.length && !diff.changed.length && !diff.removed.length) {
    return (
      <Card size="sm">
        <CardContent className="text-muted-foreground text-sm">Nova versão sem mudanças em relação à base atual.</CardContent>
      </Card>
    );
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base">Mudanças em relação à versão anterior</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-3">
        <div>
          <h3 className="mb-1 font-medium text-emerald-700 dark:text-emerald-400">Adicionados ({diff.added.length})</h3>
          <ul className="list-disc space-y-0.5 pl-4">
            {diff.added.map((id) => {
              const f = findItem(draft, id);
              return <li key={id}>{f ? itemLabel(f.section, f.item) : id}</li>;
            })}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-medium text-amber-700 dark:text-amber-400">Alterados ({diff.changed.length})</h3>
          <ul className="list-disc space-y-1 pl-4">
            {diff.changed.map((c) => (
              <li key={c.itemId}>
                <span className="text-muted-foreground line-through">{summarizeAny(c.before)}</span> → {summarizeAny(c.after)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-destructive mb-1 font-medium">Removidos ({diff.removed.length})</h3>
          <p className="text-muted-foreground mb-1 text-xs">Será marcado como ausente do currículo, não apagado.</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {diff.removed.map((r) => (
              <li key={r.factId}>{r.key}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
