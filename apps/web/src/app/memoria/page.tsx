import { Suspense } from "react";
import { MemoriesView } from "@/components/memory/memories-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <MemoriesView />
    </Suspense>
  );
}
