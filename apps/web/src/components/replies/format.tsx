import type { ApplicationListItem, ReplyType } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";

/** Mirrors REPLY_TYPE_LABELS in @autoapply/shared (value import would pull zod into the client bundle). */
export const REPLY_TYPE_LABELS: Record<ReplyType, string> = {
  interview: "entrevista",
  rejection: "recusa",
  info_request: "pedido de informação",
  confirmation: "confirmação automática",
  other: "outro",
};
export const REPLY_TYPES = Object.keys(REPLY_TYPE_LABELS) as ReplyType[];

export const REPLY_TYPE_CLASS: Record<ReplyType, string> = {
  interview: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  rejection: "bg-destructive/15 text-destructive",
  info_request: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  confirmation: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

/** Statuses that can receive a reply (manual or relink target). */
export const REPLYABLE = new Set<ApplicationListItem["status"]>(["submitted", "submit_uncertain", "already_applied"]);

export function ReplyTypeBadge({ type }: { type: ReplyType }) {
  return <Badge className={REPLY_TYPE_CLASS[type]}>{REPLY_TYPE_LABELS[type] ?? type}</Badge>;
}

const OUTCOME: Record<Exclude<ApplicationListItem["outcome"], "none">, [string, string]> = {
  replied: ["Respondida", "bg-sky-500/15 text-sky-700 dark:text-sky-400"],
  interview: ["Entrevista", "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"],
  declined: ["Recusada pela empresa", "bg-destructive/15 text-destructive"],
};

/** Outcome from company replies; hidden for `none`. */
export function OutcomeBadge({ outcome }: { outcome: ApplicationListItem["outcome"] }) {
  if (outcome === "none") return null;
  const [label, cls] = OUTCOME[outcome];
  return <Badge className={cls}>{label}</Badge>;
}

export const fmtConfidence = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
