import type { FindingType, SentenceRole, TailoredDocumentView, TailoredStatus } from "@autoapply/shared";

export const FINDING_LABEL: Record<FindingType, string> = {
  uncited: "frase sem evidência",
  unusable_fact: "fato citado não verificado",
  tech_without_evidence: "tecnologia sem evidência",
  org_without_evidence: "empresa sem evidência",
  title_without_evidence: "cargo/senioridade sem evidência",
  cert_without_evidence: "certificação sem evidência",
  number_without_evidence: "número sem evidência",
  placeholder_unresolved: "duração não calculável",
  too_long: "texto longo demais",
};

export const STATUS_LABEL: Record<TailoredStatus, string> = {
  queued: "Em fila",
  generating: "Gerando",
  draft: "Rascunho",
  needs_review: "Precisa de revisão",
  approved: "Aprovado",
  outdated: "Desatualizado",
  failed: "Falhou",
};

export const STATUS_CLASS: Record<TailoredStatus, string> = {
  queued: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  generating: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  draft: "bg-secondary text-secondary-foreground",
  needs_review: "bg-amber-500/20 text-amber-800 dark:text-amber-400",
  approved: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  outdated: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  failed: "bg-destructive/10 text-destructive",
};

export const ROLE_LABEL: Record<SentenceRole, string> = {
  greeting: "Saudação",
  body: "Corpo",
  closing: "Encerramento",
};

export const LETTER_MAX_WORDS = 250;

export const isBusy = (d: TailoredDocumentView | null | undefined) => d?.status === "queued" || d?.status === "generating";
export const hasContent = (d: TailoredDocumentView) => ["draft", "needs_review", "approved", "outdated"].includes(d.status);

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Plain letter: greeting, blank line, body sentences joined, blank line, closing. */
export function letterText(sentences: { text: string; role?: SentenceRole }[]): string {
  const pick = (r: SentenceRole) => sentences.filter((s) => (s.role ?? "body") === r).map((s) => s.text.trim());
  return [pick("greeting").join(" "), pick("body").join(" "), pick("closing").join(" ")].filter(Boolean).join("\n\n");
}
