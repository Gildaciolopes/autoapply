import type { FilterReason, JobCard, JobSourceType, Seniority, WorkMode } from "@autoapply/shared";

export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Estágio",
  junior: "Júnior",
  mid: "Pleno",
  senior: "Sênior",
  lead: "Lead/Especialista",
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
};

export const SOURCE_LABEL: Record<JobSourceType, string> = {
  gupy: "Gupy",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  google_jobs: "Google Jobs",
  linkedin_mcp: "LinkedIn",
};

export const FILTER_REASON_LABEL: Record<FilterReason, string> = {
  blocked_company: "empresa bloqueada",
  excluded_keyword: "palavra excluída",
  location_mode: "modalidade/local",
  salary_below_min: "salário abaixo do mínimo",
  seniority: "senioridade",
  off_target: "cargo fora do alvo",
};

export const label = <K extends string>(map: Record<K, string>, key: string | null | undefined): string =>
  key ? (map[key as K] ?? key) : "—";

const brl = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export function fmtSalary(j: Pick<JobCard, "salaryMin" | "salaryMax" | "salaryText">): string {
  const { salaryMin: min, salaryMax: max } = j;
  if (min != null && max != null && min !== max) return `R$ ${brl(min)} – ${brl(max)}/mês`;
  if (min != null || max != null) return `R$ ${brl((min ?? max)!)}/mês`;
  return j.salaryText?.trim() || "salário não informado";
}

export function fmtLocation(j: Pick<JobCard, "city" | "uf" | "remote" | "location" | "workMode">): string {
  if (j.remote || j.workMode === "remote") return "Remoto";
  if (j.city && j.uf) return `${j.city}/${j.uf}`;
  return j.uf ?? j.city ?? j.location ?? "local não informado";
}

/** "hoje", "há 3 dias", "há 2 meses". */
export function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "data desconhecida";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "data desconhecida";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

export function scoreClass(score: number): string {
  if (score >= 75) return "bg-emerald-600 text-white";
  if (score >= 55) return "bg-lime-500 text-black";
  if (score >= 35) return "bg-amber-400 text-black";
  return "bg-zinc-400 text-black";
}

/** "0 H * * *" → H (0–23) or null when the cron has another shape. */
export function cronHour(cron: string): number | null {
  const m = /^0 (\d{1,2}) \* \* \*$/.exec(cron.trim());
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}
