import { Suspense } from "react";
import { RenderView } from "@/components/kb/render";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <RenderView />
    </Suspense>
  );
}
