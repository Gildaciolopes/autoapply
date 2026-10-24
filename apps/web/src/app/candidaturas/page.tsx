import { Suspense } from "react";
import { ApplicationsList } from "@/components/apply/applications-list";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Carregando…</p>}>
      <ApplicationsList />
    </Suspense>
  );
}
