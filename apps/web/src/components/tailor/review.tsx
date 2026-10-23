"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { FactView, SentenceRole, TailoredDocumentView, ValidationFinding } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiRequestError, errorMessage, facts as factsApi, jobs, tailor, type SentenceEdit, type TailorDiff } from "@/lib/api";
import { checkboxClass, summarizeValue, textareaClass } from "../kb/format";
import { useLoad } from "../kb/use-load";
import { FINDING_LABEL, LETTER_MAX_WORDS, ROLE_LABEL, STATUS_CLASS, STATUS_LABEL, hasContent, isBusy, letterText, wordCount } from "./format";

type FactsById = Map<string, FactView>;

export function TailorStatusBadge({ doc }: { doc: TailoredDocumentView }) {
  return <Badge className={STATUS_CLASS[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>;
}

export function TailorReview() {
  const { id } = useParams<{ id: string }>();
  const { data: job } = useLoad(() => jobs.get(id), id);
  const { data: factList } = useLoad(() => factsApi.list({ status: "active" }));
  const { data: docs, setData, reload } = useLoad(() => tailor.forJob(id), id, {
    pollMs: 3000,
    shouldPoll: (d) => isBusy(d.resume) || isBusy(d.coverLetter),
  });
  const [tab, setTab] = useState<"resume" | "letter">("resume");

  const factsById: FactsById = useMemo(() => new Map((factList ?? []).map((f) => [f.id, f])), [factList]);

  const replace = (doc: TailoredDocumentView) =>
    setData((prev) => (prev ? { ...prev, [doc.kind === "resume" ? "resume" : "coverLetter"]: doc } : prev));

  return (
    <div className="space-y-4">
      <Link href={`/vagas/${id}`} className="text-muted-foreground text-sm hover:underline">
        ← Vaga
      </Link>
      <div>
        <h2 className="text-xl font-semibold">Currículo adaptado</h2>
        {job && (
          <p className="text-muted-foreground text-sm">
            {job.title} · {job.company ?? "empresa não informada"}
          </p>
        )}
      </div>

      {!docs && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {docs && !docs.resume && <StartCard jobId={id} onStarted={() => void reload(true)} />}
      {docs?.resume && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "resume" | "letter")}>
          <TabsList>
            <TabsTrigger value="resume">Currículo</TabsTrigger>
            {docs.coverLetter && <TabsTrigger value="letter">Carta</TabsTrigger>}
          </TabsList>
          <TabsContent value="resume" className="space-y-4 pt-2">
            {!docs.coverLetter && <GenerateLetter jobId={id} onStarted={() => void reload(true)} />}
            <DocumentPanel doc={docs.resume} factsById={factsById} onChange={replace} reload={() => void reload(true)} />
          </TabsContent>
          {docs.coverLetter && (
            <TabsContent value="letter" className="space-y-4 pt-2">
              <DocumentPanel doc={docs.coverLetter} factsById={factsById} onChange={replace} reload={() => void reload(true)} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

// ---------- start ----------

function StartCard({ jobId, onStarted }: { jobId: string; onStarted: () => void }) {
  const [letter, setLetter] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      await tailor.start(jobId, letter || undefined);
      toast.success("Adaptação em fila");
      onStarted();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "no_facts") {
        toast.error("Nenhum fato verificado na base de conhecimento — verifique seus fatos antes de adaptar.");
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4 text-sm">
        <p>
          Ainda não há currículo adaptado para esta vaga. A adaptação reordena e seleciona itens do seu currículo e escreve um resumo
          voltado para a vaga — usando apenas fatos verificados da sua{" "}
          <Link href="/conhecimento/fatos" className="underline">
            base de conhecimento
          </Link>
          . Toda frase cita os fatos que a sustentam; nada é inventado.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" className={checkboxClass} checked={letter} onChange={(e) => setLetter(e.target.checked)} />
          Gerar carta de apresentação
        </label>
        <Button disabled={busy} onClick={() => void start()}>
          {busy ? "Enviando…" : "Adaptar currículo"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GenerateLetter({ jobId, onStarted }: { jobId: string; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      await tailor.start(jobId, true);
      toast.success("Carta em fila (o currículo também é regerado)");
      onStarted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sem carta de apresentação.</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void start()}>
        Gerar carta
      </Button>
    </div>
  );
}

// ---------- document (resume or letter) ----------

function DocumentPanel({
  doc,
  factsById,
  onChange,
  reload,
}: {
  doc: TailoredDocumentView;
  factsById: FactsById;
  onChange: (doc: TailoredDocumentView) => void;
  reload: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const isLetter = doc.kind === "cover_letter";

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const approve = () =>
    run("approve", async () => {
      onChange(await tailor.approve(doc.id));
      toast.success("Aprovado");
    });
  const regenerate = () =>
    run("regenerate", async () => {
      await tailor.regenerate(doc.id);
      toast.success("Regeneração em fila");
      reload();
    });
  const download = () =>
    run("pdf", async () => {
      const blob = await tailor.pdf(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isLetter ? "carta.pdf" : "curriculo.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  const copy = () =>
    run("copy", async () => {
      await navigator.clipboard.writeText(letterText(doc.sentences));
      toast.success("Texto copiado");
    });

  const busyDoc = isBusy(doc);
  const findings = doc.validation.findings;
  const words = wordCount(doc.sentences.map((s) => s.text).join(" "));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TailorStatusBadge doc={doc} />
        {doc.userEdited && <Badge variant="outline">editado por você</Badge>}
        {isLetter && hasContent(doc) && (
          <span className={words > LETTER_MAX_WORDS ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {words}/{LETTER_MAX_WORDS} palavras
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {doc.status === "draft" && (
            <Button size="sm" disabled={busy !== null} onClick={() => void approve()}>
              Aprovar
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy !== null || busyDoc} onClick={() => void regenerate()}>
            {busy === "regenerate" ? "Enviando…" : "Regenerar"}
          </Button>
          {hasContent(doc) && (
            <Button size="sm" variant="outline" disabled={busy !== null || doc.status === "outdated"} onClick={() => void download()}>
              {busy === "pdf" ? "Gerando PDF…" : "Baixar PDF"}
            </Button>
          )}
          {isLetter && hasContent(doc) && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void copy()}>
              Copiar texto
            </Button>
          )}
        </div>
      </div>

      {busyDoc && <p className="text-muted-foreground text-sm">Gerando com o LLM local… isso pode levar alguns minutos.</p>}
      {doc.status === "failed" && (
        <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-3 text-sm">
          Falha na geração{doc.error ? `: ${doc.error}` : ""}. Tente regenerar.
        </div>
      )}
      {doc.status === "outdated" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3 text-sm">
          <span>Fatos mudaram — gere novamente.</span>
          <Button size="sm" disabled={busy !== null} onClick={() => void regenerate()}>
            Regenerar
          </Button>
        </div>
      )}
      {doc.status === "needs_review" && findings.length > 0 && (
        <FindingsBox
          title="O validador encontrou afirmações sem evidência — edite o texto ou regenere antes de aprovar."
          findings={findings}
        />
      )}

      {hasContent(doc) && (
        <>
          <SentencesCard doc={doc} factsById={factsById} onSaved={onChange} />
          {!isLetter && <DiffPanel doc={doc} onChange={onChange} />}
          <PdfPreview doc={doc} />
        </>
      )}
    </div>
  );
}

function FindingsBox({ title, findings }: { title: string; findings: ValidationFinding[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">{title}</p>
      <ul className="space-y-1">
        {findings.map((f, i) => (
          <li key={`${f.sentenceIndex}:${f.type}:${f.token}:${i}`}>
            Frase {f.sentenceIndex + 1}: {FINDING_LABEL[f.type] ?? f.type}
            {f.token && (
              <>
                {" "}
                — <code className="bg-muted rounded px-1">{f.token}</code>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- sentences (summary / letter) ----------

const ROLES: SentenceRole[] = ["greeting", "body", "closing"];

function FactChips({ factIds, factsById }: { factIds: string[]; factsById: FactsById }) {
  if (factIds.length === 0) return <Badge variant="destructive">sem fatos citados</Badge>;
  return (
    <>
      {factIds.map((fid) => {
        const f = factsById.get(fid);
        const text = f ? summarizeValue(f.kind, f.value) : fid.slice(0, 8);
        return (
          <Link key={fid} href="/conhecimento/fatos" title={f ? `${text} (${fid})` : fid}>
            <Badge variant="outline" className="max-w-56 truncate">
              {text}
            </Badge>
          </Link>
        );
      })}
    </>
  );
}

function SentencesCard({
  doc,
  factsById,
  onSaved,
}: {
  doc: TailoredDocumentView;
  factsById: FactsById;
  onSaved: (doc: TailoredDocumentView) => void;
}) {
  const isLetter = doc.kind === "cover_letter";
  const [editing, setEditing] = useState<SentenceEdit[] | null>(null);
  const [findings, setFindings] = useState<ValidationFinding[]>([]);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setFindings([]);
    setEditing(doc.sentences.map((s) => ({ text: s.text, factIds: s.factIds, ...(s.role ? { role: s.role } : {}) })));
  };

  async function save() {
    if (!editing) return;
    const sentences = editing.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
    if (sentences.length === 0) {
      toast.error("Mantenha ao menos uma frase");
      return;
    }
    setSaving(true);
    try {
      const view = await tailor.patch(doc.id, { sentences });
      onSaved(view);
      setEditing(null);
      setFindings([]);
      toast.success("Texto salvo e validado");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422 && Array.isArray(err.details)) {
        setEditing(sentences);
        setFindings(err.details as ValidationFinding[]);
        toast.error("Validação falhou — nada foi salvo");
      } else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const title = isLetter ? "Carta de apresentação" : "Resumo";
  const editWords = editing ? wordCount(editing.map((s) => s.text).join(" ")) : 0;

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Editar {isLetter ? "carta" : "resumo"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Cada frase mantém os fatos que cita. O texto é revalidado ao salvar; se houver afirmações sem evidência, nada é salvo.
          </p>
          {findings.length > 0 && <FindingsBox title="Validação falhou — nada foi salvo." findings={findings} />}
          {editing.map((s, i) => {
            const mine = findings.filter((f) => f.sentenceIndex === i);
            return (
              <div key={i} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    #{i + 1}
                    {isLetter && s.role ? ` · ${ROLE_LABEL[s.role]}` : ""}
                  </span>
                  <FactChips factIds={s.factIds} factsById={factsById} />
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      setEditing((prev) => prev!.filter((_, j) => j !== i));
                      setFindings([]);
                    }}
                  >
                    Remover frase
                  </Button>
                </div>
                <textarea
                  aria-label={`Frase ${i + 1}`}
                  className={`${textareaClass} ${mine.length ? "border-amber-500" : ""}`}
                  value={s.text}
                  onChange={(e) => {
                    const text = e.target.value;
                    setEditing((prev) => prev!.map((x, j) => (j === i ? { ...x, text } : x)));
                  }}
                />
                {mine.map((f, k) => (
                  <p key={k} className="text-xs text-amber-700 dark:text-amber-400">
                    {FINDING_LABEL[f.type] ?? f.type}
                    {f.token ? `: ${f.token}` : ""}
                  </p>
                ))}
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Validando…" : "Salvar"}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            {isLetter && (
              <span className={editWords > LETTER_MAX_WORDS ? "text-destructive ml-auto" : "text-muted-foreground ml-auto"}>
                {editWords}/{LETTER_MAX_WORDS} palavras
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const indexed = doc.sentences.map((s, i) => ({ s, i }));
  const groups: { role: SentenceRole | null; items: typeof indexed }[] = isLetter
    ? ROLES.map((role) => ({ role, items: indexed.filter(({ s }) => (s.role ?? "body") === role) })).filter((g) => g.items.length)
    : [{ role: null, items: indexed }];
  const flagged = new Set(doc.validation.findings.map((f) => f.sentenceIndex));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Button size="sm" variant="outline" onClick={startEdit}>
            {isLetter ? "Editar carta" : "Editar resumo"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {doc.sentences.length === 0 && <p className="text-muted-foreground">Sem texto.</p>}
        {groups.map((g) => (
          <div key={g.role ?? "all"} className="space-y-3">
            {g.role && <p className="text-muted-foreground text-xs font-medium uppercase">{ROLE_LABEL[g.role]}</p>}
            {g.items.map(({ s, i }) => (
              <div key={i} className={`space-y-1.5 ${flagged.has(i) ? "rounded-md border-l-2 border-amber-500 pl-2" : ""}`}>
                <p>
                  <span className="text-muted-foreground mr-1 text-xs">#{i + 1}</span>
                  {s.text}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <FactChips factIds={s.factIds} factsById={factsById} />
                  {(s.computed ?? []).map((c) => (
                    <Badge key={c.token} className="bg-sky-500/15 text-sky-700 dark:text-sky-400" title={c.source.join(", ")}>
                      {c.value} — calculado de {c.source.length} {c.source.length === 1 ? "fato" : "fatos"}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- diff ----------

const TOGGLEABLE = new Set(["experience", "projects", "education", "certifications"]);

function DiffPanel({ doc, onChange }: { doc: TailoredDocumentView; onChange: (doc: TailoredDocumentView) => void }) {
  const { data: diff } = useLoad(() => tailor.diff(doc.id), `${doc.id}:${doc.updatedAt}`);
  const [busy, setBusy] = useState(false);
  const planHidden = doc.plan.hiddenItemIds;

  async function setHidden(itemId: string, hide: boolean) {
    const next = hide ? [...new Set([...planHidden, itemId])] : planHidden.filter((x) => x !== itemId);
    setBusy(true);
    try {
      onChange(await tailor.patch(doc.id, { hiddenItemIds: next }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Original × adaptado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!diff && <p className="text-muted-foreground">Carregando…</p>}
        {diff && (
          <>
            {diff.changes.skillsReordered && <p className="text-muted-foreground text-xs">Habilidades reordenadas por relevância para a vaga.</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <DiffColumn title="Original" diff={diff} side="base" planHidden={planHidden} busy={busy} onToggle={setHidden} />
              <DiffColumn title="Adaptado" diff={diff} side="tailored" planHidden={planHidden} busy={busy} onToggle={setHidden} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DiffColumn({
  title,
  diff,
  side,
  planHidden,
  busy,
  onToggle,
}: {
  title: string;
  diff: TailorDiff;
  side: "base" | "tailored";
  planHidden: string[];
  busy: boolean;
  onToggle: (id: string, hide: boolean) => void;
}) {
  const model = diff[side];
  const moved = new Set(diff.changes.moved.map((m) => m.id));
  const hidden = new Set(diff.changes.hidden);
  const restorable = new Set(planHidden);

  const control = (sectionId: string, itemId: string) => {
    if (!TOGGLEABLE.has(sectionId)) return null;
    if (side === "tailored")
      return (
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => onToggle(itemId, true)}>
          Ocultar
        </Button>
      );
    if (hidden.has(itemId) && restorable.has(itemId))
      return (
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => onToggle(itemId, false)}>
          Restaurar
        </Button>
      );
    return null;
  };
  const marks = (itemId: string) => (
    <>
      {side === "tailored" && moved.has(itemId) && <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400">movido</Badge>}
      {side === "base" && hidden.has(itemId) && <Badge variant="secondary">oculto</Badge>}
    </>
  );
  const struck = (itemId: string) => (side === "base" && hidden.has(itemId) ? "text-muted-foreground line-through" : "");

  return (
    <div className="min-w-0 space-y-3 rounded-lg border p-3">
      <p className="font-medium">{title}</p>
      {model.sections.map((sec) => (
        <div key={sec.id} className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase">{sec.title}</p>
          {sec.entries.map((e) => (
            <div key={e.id} className="space-y-1">
              {(e.heading || e.sub || e.dates) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`font-medium ${struck(e.id)}`}>
                    {[e.heading, e.sub].filter(Boolean).join(" — ")}
                    {e.dates && <span className="text-muted-foreground font-normal"> · {e.dates}</span>}
                  </span>
                  {marks(e.id)}
                  {control(sec.id, e.id)}
                </div>
              )}
              {e.text && <p className={`text-muted-foreground ${struck(e.id)}`}>{e.text}</p>}
              {e.bullets.length > 0 && (
                <ul className="ml-4 list-disc space-y-1">
                  {e.bullets.map((b) => (
                    <li key={b.id}>
                      <span className={struck(b.id)}>{b.text}</span> {marks(b.id)} {control(sec.id, b.id)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------- PDF preview ----------

function PdfPreview({ doc }: { doc: TailoredDocumentView }) {
  const [state, setState] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const key = `${doc.id}:${doc.updatedAt}:${doc.status}`;

  useEffect(() => {
    if (doc.status === "outdated") return;
    let url: string | undefined;
    let cancelled = false;
    tailor.pdf(doc.id).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ key, url });
      },
      (err: unknown) => {
        if (!cancelled) setState({ key, error: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, doc.status, key]);

  const current = state?.key === key ? state : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pré-visualização</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {doc.status === "outdated" ? (
          <p className="text-muted-foreground">Documento desatualizado: gere novamente para ver o PDF.</p>
        ) : !current ? (
          <p className="text-muted-foreground">Gerando PDF…</p>
        ) : current.error ? (
          <p className="text-destructive">{current.error}</p>
        ) : (
          <iframe title="PDF" src={current.url} className="h-[80vh] w-full rounded-md border" />
        )}
      </CardContent>
    </Card>
  );
}
