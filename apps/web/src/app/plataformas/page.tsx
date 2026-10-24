import { Suspense } from "react";
import { PlatformsView } from "@/components/platforms/platforms-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <PlatformsView />
    </Suspense>
  );
}
