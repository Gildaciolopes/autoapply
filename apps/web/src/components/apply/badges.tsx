import type { ApplicationStatus } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { APP_STATUS_CLASS, APP_STATUS_LABEL, reasonLabel } from "./format";

export function AppStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge className={APP_STATUS_CLASS[status]}>{APP_STATUS_LABEL[status]}</Badge>;
}

export function ReasonChip({ code, count }: { code: string; count?: number }) {
  return (
    <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-400">
      {reasonLabel(code)}
      {count !== undefined && ` · ${count}`}
    </Badge>
  );
}
