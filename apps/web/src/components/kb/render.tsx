"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { RenderItem } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage, render, type LintResult } from "@/lib/api";
import { checkboxClass } from "./format";

type Lang = "pt" | "en";

export function RenderView() {
  const [lang, setLang] = useState<Lang>("pt");
  const [dryRun, setDryRun] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [lint, setLint] = useState<LintResult | null>(null);
  const [overflow, setOverflow] = useState<{ pages: number; items: RenderItem[] } | null>(null);

  // Revoke the previous object URL whenever it is replaced or on unmount.
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  async function generate() {
    const body = { lang, dryRun, hiddenItemIds: [...hidden] };
    setBusy(true);
    try {
      const r = await render.pdf(body);
      if (r.overflow) {
        setOverflow({ pages: r.pages, items: r.items });
        setPdfUrl(null);
        setLint(null);
        return;
      }
      setOverflow(null);
      setPdfUrl(URL.createObjectURL(r.pdf));
      setScore(r.atsScore);
      try {
        setLint(await render.lint(body));
      } catch (err) {
        toast.error(`Lint ATS: ${errorMessage(err)}`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleHidden(id: string, on: boolean) {
    setHidden((h) => {
      const n = new Set(h);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  const grouped = overflow
    ? overflow.items.reduce<Record<string, RenderItem[]>>((acc, it) => {
        (acc[it.section] ??= []).push(it);
        return acc;
      }, {})
    : {};
  const failed = lint?.checks.filter((c) => !c.pass) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex overflow-hidden rounded-lg border">
            {(["pt", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 text-sm ${lang === l ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {l === "pt" ? "Português" : "English"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" className={checkboxClass} checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Incluir não verificados (marca d&apos;água DRY-RUN)
          </label>
          <Button disabled={busy} onClick={generate}>
            {busy ? "Gerando…" : "Gerar PDF"}
          </Button>
          {pdfUrl && (
            <a href={pdfUrl} download={`curriculo-${lang}.pdf`} className="text-primary text-sm font-medium hover:underline">
              Baixar PDF
            </a>
          )}
          {hidden.size > 0 && <span className="text-muted-foreground">{hidden.size} item(ns) oculto(s)</span>}
        </CardContent>
      </Card>

      {overflow && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">O currículo ocupa {overflow.pages} páginas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Escolha itens para ocultar nesta versão e gere de novo (a base não é alterada).</p>
            {Object.entries(grouped).map(([section, items]) => (
              <div key={section}>
                <h3 className="mb-1 font-medium">{section}</h3>
                <ul className="space-y-1">
                  {items.map((it) => (
                    <li key={it.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={hidden.has(it.id)}
                          onChange={(e) => toggleHidden(it.id, e.target.checked)}
                        />
                        {it.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Button disabled={busy || hidden.size === 0} onClick={generate}>
              Gerar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {pdfUrl && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <iframe src={pdfUrl} title="Currículo gerado" className="h-[85vh] w-full rounded-xl border" />
          <Card className="self-start">
            <CardHeader>
              <CardTitle className="text-base">Score ATS: {score ?? lint?.score ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!lint ? (
                <p className="text-muted-foreground">Sem resultado do lint.</p>
              ) : failed.length === 0 ? (
                <Badge>todas as verificações passaram</Badge>
              ) : (
                <ul className="space-y-1">
                  {failed.map((c) => (
                    <li key={c.id}>
                      <Badge variant="destructive">{c.id}</Badge> {c.detail}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
