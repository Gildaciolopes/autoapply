import { Suspense } from "react";
import { FactsView } from "@/components/kb/facts";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <FactsView />
    </Suspense>
  );
}
