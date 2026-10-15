import { Suspense } from "react";
import { ResumeDetailView } from "@/components/kb/resume-detail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ResumeDetailView />
    </Suspense>
  );
}
