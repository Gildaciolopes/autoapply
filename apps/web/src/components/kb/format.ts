import type { FactKind, FactOrigin, GithubEvidence, LooseDate } from "@autoapply/shared";

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const KIND_LABEL: Record<FactKind, string> = {
  experience: "Experiência",
  skill: "Skill",
  metric: "Métrica",
  project: "Projeto",
  education: "Formação",
  certification: "Certificação",
  language: "Idioma",
  personal: "Pessoal",
  preference: "Preferência",
};

export const ORIGIN_LABEL: Record<FactOrigin, string> = {
  resume: "Currículo",
  linkedin: "LinkedIn",
  github: "GitHub",
  user: "Você",
};

export function originLabel(origin: string): string {
  return ORIGIN_LABEL[origin as FactOrigin] ?? origin;
}

export function fmtLooseDate(d: LooseDate | null | undefined): string {
  if (d === "present") return "atual";
  if (!d) return "?";
  return d.precision === "month" && d.month ? `${MONTHS[d.month - 1]}/${d.year}` : String(d.year);
}

export function fmtRange(start: LooseDate | null | undefined, end: LooseDate | null | undefined): string {
  if (!start && !end) return "";
  return `${fmtLooseDate(start)} – ${fmtLooseDate(end)}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

export function fmtDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

export function githubEvidence(value: unknown): GithubEvidence | undefined {
  const ev = (value as Obj | null)?.evidence;
  return ev && typeof ev === "object" ? (ev as GithubEvidence) : undefined;
}

/** One-line human summary of a fact value, by kind. */
export function summarizeValue(kind: FactKind | string, value: unknown): string {
  const v = (value ?? {}) as Obj;
  switch (kind) {
    case "experience": {
      const range = fmtRange(v.start as LooseDate, v.end as LooseDate);
      return `${str(v.title)} — ${str(v.company)}${range ? ` (${range})` : ""}`;
    }
    case "skill":
      return `${str(v.name)}${v.category ? ` · ${str(v.category)}` : ""}`;
    case "education": {
      const parts = [v.degree, v.area].filter(Boolean).map(str).join(", ");
      const range = fmtRange(v.start as LooseDate, v.end as LooseDate);
      return `${str(v.institution)}${parts ? ` — ${parts}` : ""}${range ? ` (${range})` : ""}`;
    }
    case "certification":
      return `${str(v.name)}${v.issuer ? ` · ${str(v.issuer)}` : ""}${v.date ? ` (${fmtLooseDate(v.date as LooseDate)})` : ""}`;
    case "language":
      return `${str(v.language)}${v.fluency ? ` · ${str(v.fluency)}` : ""}`;
    case "project":
      return `${str(v.name)}${v.description ? ` — ${str(v.description)}` : ""}`;
    case "metric":
      return `${str(v.label)}: ${str(v.value)}`;
    case "personal":
      return `${str(v.field)} = ${str(v.value)}`;
    case "preference":
      return `${str(v.name)} = ${str(v.value)}`;
    default:
      return str(value);
  }
}

/** `github:<owner/repo>:<file>` → link to the repo (languages) or the file. */
export function githubRefUrl(ref: string): string | null {
  const m = /^github:([^:]+\/[^:]+):(.+)$/.exec(ref);
  if (!m) return null;
  const [, repo, file] = m;
  return file === "languages" ? `https://github.com/${repo}` : `https://github.com/${repo}/blob/HEAD/${file}`;
}

export const nativeSelectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export const textareaClass =
  "w-full min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export const checkboxClass = "size-4 rounded border-input accent-primary";
