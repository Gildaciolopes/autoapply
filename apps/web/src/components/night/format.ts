import type { NightPhase, NightStatus, ReportStatus } from "@autoapply/shared";

/** Every night time is shown in the user's zone (the scheduler works in America/Sao_Paulo). */
export const TZ = "America/Sao_Paulo";

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** `nightDate` is a calendar date (YYYY-MM-DD) — format it without a time-zone shift. */
export function fmtNightDate(day: string): string {
  const [y, m, d] = day.split("-");
  return y && m && d ? `${d}/${m}/${y}` : day;
}

export const STATUS_LABEL: Record<NightStatus, string> = {
  running: "Em andamento",
  ok: "Concluída",
  partial: "Parcial",
  failed: "Falhou",
  stopped: "Parada",
  skipped: "Pulada",
  missed: "Perdida",
};

export const STATUS_CLASS: Record<NightStatus, string> = {
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  ok: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  partial: "bg-amber-500/20 text-amber-800 dark:text-amber-400",
  failed: "bg-destructive/15 text-destructive",
  stopped: "bg-orange-500/20 text-orange-800 dark:text-orange-400",
  skipped: "bg-secondary text-secondary-foreground",
  missed: "bg-secondary text-secondary-foreground",
};

export const PHASE_LABEL: Record<NightPhase, string> = {
  discovering: "Buscando vagas",
  preparing: "Preparando candidaturas",
  waiting: "Aguardando simulações",
  finishing: "Finalizando",
  done: "Encerrada",
};

export const TRIGGER_LABEL: Record<"schedule" | "manual", string> = { schedule: "Agendada", manual: "Manual" };

export const REPORT_LABEL: Record<ReportStatus, string> = {
  pending: "pendente",
  sent: "enviado",
  not_sent: "não enviado",
  not_configured: "Telegram não configurado",
};

export const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export const TELEGRAM_MISSING = "Telegram não configurado: defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env";
