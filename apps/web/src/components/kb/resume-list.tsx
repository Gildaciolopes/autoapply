"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ResumeStatus } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, resumes } from "@/lib/api";
import { fmtDateTime } from "./format";
import { useLoad } from "./use-load";

export const RESUME_STATUS: Record<ResumeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  uploaded: { label: "Processando", variant: "secondary" },
  parsing: { label: "Processando", variant: "secondary" },
  review: { label: "Revisar", variant: "default" },
  confirmed: { label: "Confirmado", variant: "outline" },
  failed: { label: "Falhou", variant: "destructive" },
  image_only: { label: "Só imagem", variant: "destructive" },
  discarded: { label: "Descartado", variant: "outline" },
};

export const isProcessing = (s: ResumeStatus) => s === "uploaded" || s === "parsing";

const EXTRACTION_LABEL = { text: "texto", vision: "visão (OCR)", manual: "manual" } as const;

export function ResumeList() {
  const { data, reload, loading } = useLoad(resumes.list, "", {
    pollMs: 3000,
    shouldPoll: (list) => list.some((r) => isProcessing(r.status)),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Escolha um arquivo PDF");
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      await resumes.upload(form);
      toast.success("Currículo enviado; processando…");
      if (fileRef.current) fileRef.current.value = "";
      await reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enviar currículo (PDF, até 5 MB)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onUpload} className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept="application/pdf"
              className="file:bg-muted text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
            <Button type="submit" disabled={uploading}>
              {uploading ? "Enviando…" : "Enviar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {!data ? (
        <p className="text-muted-foreground text-sm">{loading ? "Carregando…" : "Não foi possível carregar."}</p>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum currículo enviado ainda.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Extração</TableHead>
              <TableHead>Enviado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/conhecimento/curriculo/${r.id}`} className="font-medium hover:underline">
                    {r.fileName}
                  </Link>
                  {r.active && (
                    <Badge variant="secondary" className="ml-2">
                      ativo
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={RESUME_STATUS[r.status].variant}>{RESUME_STATUS[r.status].label}</Badge>
                  {r.error && <div className="text-destructive mt-1 text-xs">{r.error}</div>}
                </TableCell>
                <TableCell>v{r.version}</TableCell>
                <TableCell>{EXTRACTION_LABEL[r.extraction]}</TableCell>
                <TableCell>{fmtDateTime(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
