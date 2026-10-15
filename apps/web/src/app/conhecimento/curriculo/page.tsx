import { Suspense } from "react";
import { ResumeList } from "@/components/kb/resume-list";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ResumeList />
    </Suspense>
  );
}
