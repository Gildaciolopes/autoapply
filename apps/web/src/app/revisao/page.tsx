import { Suspense } from "react";
import { ReviewView } from "@/components/review/review-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ReviewView />
    </Suspense>
  );
}
