import { Suspense } from "react";
import { JobDetailView } from "@/components/jobs/job-detail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <JobDetailView />
    </Suspense>
  );
}
