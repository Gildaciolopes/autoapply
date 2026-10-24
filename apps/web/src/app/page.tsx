import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Health = Record<"db" | "redis" | "ollama", "up" | "down">;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

// Screens planned in docs/roadmap.md; each one ships with its own spec.
const SCREENS: readonly (readonly [string, string, string?])[] = [
  ["Base de conhecimento", "F1 · CV, LinkedIn, GitHub, fatos e conflitos", "/conhecimento"],
  ["Preferências", "F2 · cargos, stack, senioridade, fontes, limites", "/vagas/preferencias"],
  ["Vagas", "F2 · feed com score e skills que batem/faltam", "/vagas"],
  ["Candidaturas", "F4/F5 · simulações, aprovação e envio real com screenshots de prova", "/candidaturas"],
  ["Plataformas", "F5 · login na Gupy/LinkedIn, limites diários e pausas", "/plataformas"],
  ["Ao vivo", "F6 · logs em tempo real e kill switch"],
];

// Dynamic (uncached) data must render inside <Suspense> with cacheComponents (Next 16).
async function HealthBadges() {
  const health = await getHealth();
  if (!health) return <Badge variant="destructive">api: down ({API_URL})</Badge>;
  return Object.entries(health).map(([name, state]) => (
    <Badge key={name} variant={state === "up" ? "default" : "destructive"}>
      {name}: {state}
    </Badge>
  ));
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">AutoApply</h1>
        <p className="text-muted-foreground text-sm">Aplicador automático de vagas com IA local · modo review</p>
      </header>

      <section className="flex flex-wrap gap-2">
        <Suspense fallback={<Badge variant="secondary">verificando…</Badge>}>
          <HealthBadges />
        </Suspense>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map(([title, desc, href]) => {
          const card = (
            <Card className={href ? "hover:bg-muted/40 h-full transition-colors" : "h-full opacity-70"}>
              <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">{desc}</CardContent>
            </Card>
          );
          return href ? (
            <Link key={title} href={href}>
              {card}
            </Link>
          ) : (
            <div key={title}>{card}</div>
          );
        })}
      </section>
    </main>
  );
}
