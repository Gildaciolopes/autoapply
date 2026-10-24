import { Suspense } from "react";
import { RepliesView } from "@/components/replies/replies-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <RepliesView />
    </Suspense>
  );
}
