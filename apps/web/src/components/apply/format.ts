import type { AnswerSource, ApplicationStatus, ApplicationView, ArtifactView, AtsKind, NeedsReasonCode } from "@autoapply/shared";

export const APP_STATUS_LABEL: Record<ApplicationStatus, string> = {
  queued: "Na fila",
  tailoring: "Adaptando currículo",
  applying: "Simulando",
  ready: "Simulado — pronto para enviar",
  needs_input: "Precisa de você",
  approved: "Aprovada — na fila de envio",
  submitting: "Enviando…",
  submitted: "Enviada",
  submit_uncertain: "Envio incerto",
  already_applied: "Já candidatado",
  failed: "Falhou",
  skipped: "Cancelado",
  rejected: "Rejeitada por você",
};

export const APP_STATUS_CLASS: Record<ApplicationStatus, string> = {
  queued: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  tailoring: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  applying: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  ready: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  needs_input: "bg-amber-500/20 text-amber-800 dark:text-amber-400",
  approved: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  submitting: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  submitted: "bg-emerald-600 text-white",
  submit_uncertain: "bg-orange-500/20 text-orange-800 dark:text-orange-400",
  already_applied: "bg-secondary text-secondary-foreground",
  failed: "bg-destructive/10 text-destructive",
  skipped: "bg-secondary text-secondary-foreground",
  rejected: "bg-secondary text-secondary-foreground",
};

export const REASON_LABEL: Record<NeedsReasonCode, string> = {
  captcha: "Captcha",
  bot_protection: "Proteção anti-robô",
  login_required: "Login necessário",
  low_confidence: "Confiança baixa",
  no_evidence: "Sem evidência",
  missing_fact: "Dado não cadastrado",
  validation_failed: "Reprovado no validador",
  tailoring_needs_review: "Currículo precisa de revisão",
  cover_letter_required: "Carta necessária",
  attachment_rejected: "Anexo recusado",
  daily_cap: "Limite diário",
  cancelled: "Cancelado",
  job_closed: "Vaga encerrada",
  session_expired: "Sessão expirada",
  already_applied: "Já candidatado",
  platform_action: "Ação na plataforma",
  unusual_activity: "Atividade incomum",
  form_changed: "Formulário mudou",
  new_step: "Nova etapa",
  human_check: "Verificação humana",
  platform_paused: "Plataforma pausada",
  window_end: "Fim da janela noturna",
};

/** pt-BR explanation shown next to reasons whose server message is not enough. */
export const REASON_HINT: Partial<Record<NeedsReasonCode, string>> = {
  human_check:
    "Captcha/verificação na hora de enviar: uma janela foi aberta para você concluir e clicar em enviar. O AutoApply não resolve captcha.",
};

/** Reasons that only the user can resolve on the real site (no captcha solving, no evasion). */
export const MANUAL_REASONS: ReadonlySet<string> = new Set<NeedsReasonCode>(["captcha", "login_required", "bot_protection"]);

export const SOURCE_LABEL: Record<AnswerSource, string> = {
  fato: "Seus dados",
  memória: "Resposta salva",
  calculado: "Calculado",
  regra: "Regra",
  modelo: "IA (validada)",
  usuário: "Você",
  anexo: "Anexo",
};

export const ATS_LABEL: Record<AtsKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  generic: "Genérico",
  gupy: "Gupy",
  linkedin: "LinkedIn",
};

/** Status label with how the submission happened (assisted = user finished it in the opened window). */
export function statusLabel(app: Pick<ApplicationView, "status" | "submittedVia">): string {
  const base = APP_STATUS_LABEL[app.status];
  if (app.status !== "submitted") return base;
  if (app.submittedVia === "assisted") return `${base} (assistida)`;
  if (app.submittedVia === "manual") return `${base} (marcada por você)`;
  return base;
}

/** pt-BR reasons for approvals the API refused. */
export const REFUSED_LABEL: Record<string, string> = {
  not_ready: "não está pronta",
  outdated: "desatualizada",
  platform_not_connected: "plataforma não conectada",
  dry_run_mode: "modo simulação",
};

export const refusedLabel = (code: string) => REFUSED_LABEL[code] ?? code;

export const reasonLabel = (code: string) => REASON_LABEL[code as NeedsReasonCode] ?? code;

export const isAppBusy = (status: ApplicationStatus | undefined) =>
  status === "queued" || status === "tailoring" || status === "applying";

/** Approved for real submission and not finished yet. */
export const isSubmitPending = (status: ApplicationStatus | undefined) => status === "approved" || status === "submitting";

export const fmtPercent = (x: number) => `${Math.round(x * 100)}%`;

const SHOT_ORDER = (label: string) => {
  if (label === "before") return 0;
  if (label === "after") return 10_000;
  if (label === "last") return 20_000;
  if (label === "submit-filled") return 30_000;
  if (label === "confirmation") return 40_000;
  const m = /^step-(\d+)$/.exec(label);
  return m ? Number(m[1]) : 5_000;
};

export function shotLabel(label: string): string {
  if (label === "before") return "Antes";
  if (label === "after") return "Depois (preenchido)";
  if (label === "last") return "Última tela";
  if (label === "submit-filled") return "Preenchido antes do envio";
  if (label === "confirmation") return "Confirmação do envio";
  const m = /^step-(\d+)$/.exec(label);
  return m ? `Etapa ${m[1]}` : label;
}

/** Screenshots grouped by attempt (latest first), each group in before → step-N → after → last order. */
export function groupArtifacts(artifacts: ArtifactView[]): { attempt: number; items: ArtifactView[] }[] {
  const byAttempt = new Map<number, ArtifactView[]>();
  for (const a of artifacts) byAttempt.set(a.attempt, [...(byAttempt.get(a.attempt) ?? []), a]);
  return [...byAttempt.entries()]
    .sort(([a], [b]) => b - a)
    .map(([attempt, items]) => ({ attempt, items: [...items].sort((x, y) => SHOT_ORDER(x.label) - SHOT_ORDER(y.label)) }));
}
