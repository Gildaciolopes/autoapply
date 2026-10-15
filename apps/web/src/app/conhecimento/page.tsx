import { Suspense } from "react";
import { Overview } from "@/components/kb/overview";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <Overview />
    </Suspense>
  );
}
