import { Suspense } from "react";
import { ApplicationPage } from "@/components/apply/application-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ApplicationPage />
    </Suspense>
  );
}
