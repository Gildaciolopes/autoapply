import type { ApplicationStatus, ApplicationView } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { APP_STATUS_CLASS, reasonLabel, statusLabel } from "./format";

export function AppStatusBadge({ status, submittedVia = null }: { status: ApplicationStatus; submittedVia?: ApplicationView["submittedVia"] }) {
  return <Badge className={APP_STATUS_CLASS[status]}>{statusLabel({ status, submittedVia })}</Badge>;
}

export function ReasonChip({ code, count }: { code: string; count?: number }) {
  return (
    <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-400">
      {reasonLabel(code)}
      {count !== undefined && ` · ${count}`}
    </Badge>
  );
}
