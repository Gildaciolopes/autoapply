"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { JobCard } from "@autoapply/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage, jobs } from "@/lib/api";

/** Shared job actions (feed card + detail): open, interesting, hide, block company. */
export function JobActions({
  job,
  onChange,
  onBlocked,
}: {
  job: JobCard;
  onChange: (patch: Partial<JobCard>) => void;
  onBlocked?: (company: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (field: "interesting" | "hidden") =>
    run(async () => {
      const r = await jobs.patch(job.id, { [field]: !job[field] });
      onChange({ interesting: r.interesting, hidden: r.hidden });
      if (field === "hidden") toast.success(r.hidden ? "Vaga ocultada" : "Vaga visível novamente");
    });

  const block = () => {
    if (!job.company) return;
    if (!window.confirm(`Bloquear a empresa "${job.company}"? Vagas dela deixam de aparecer no feed.`)) return;
    void run(async () => {
      const r = await jobs.blockCompany(job.id);
      toast.success(`Empresa "${r.company}" bloqueada — ${r.hiddenJobs} vaga(s) filtrada(s)`);
      onBlocked?.(r.company);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <a href={job.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Abrir vaga ↗
      </a>
      <Button size="sm" variant={job.interesting ? "default" : "outline"} disabled={busy} onClick={() => void toggle("interesting")}>
        {job.interesting ? "★ Interessante" : "☆ Interessante"}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggle("hidden")}>
        {job.hidden ? "Mostrar" : "Ocultar"}
      </Button>
      {job.company && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={block}>
          Bloquear empresa
        </Button>
      )}
    </div>
  );
}
