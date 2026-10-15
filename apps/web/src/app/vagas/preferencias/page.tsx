import { Suspense } from "react";
import { PreferencesView } from "@/components/jobs/preferences";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <PreferencesView />
    </Suspense>
  );
}
