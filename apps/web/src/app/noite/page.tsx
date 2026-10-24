import { Suspense } from "react";
import { NightView } from "@/components/night/night-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <NightView />
    </Suspense>
  );
}
