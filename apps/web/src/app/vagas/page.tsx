import { Suspense } from "react";
import { FeedView } from "@/components/jobs/feed";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <FeedView />
    </Suspense>
  );
}
