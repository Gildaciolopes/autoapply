import { Suspense } from "react";
import { ConflictsView } from "@/components/kb/conflicts";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ConflictsView />
    </Suspense>
  );
}
