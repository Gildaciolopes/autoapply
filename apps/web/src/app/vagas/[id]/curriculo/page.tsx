import { Suspense } from "react";
import { TailorReview } from "@/components/tailor/review";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <TailorReview />
    </Suspense>
  );
}
