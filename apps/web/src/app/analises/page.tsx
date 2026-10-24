import { Suspense } from "react";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <AnalyticsView />
    </Suspense>
  );
}
