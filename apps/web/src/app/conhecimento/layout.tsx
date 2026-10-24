import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";

const NAV = [
  ["/conhecimento", "Visão geral"],
  ["/conhecimento/curriculo", "Currículo"],
  ["/conhecimento/fatos", "Fatos"],
  ["/conhecimento/pessoal", "Pessoal"],
  ["/conhecimento/conflitos", "Conflitos"],
  ["/conhecimento/render", "Renderizar"],
] as const;

export default function KnowledgeLayout({ children }: LayoutProps<"/conhecimento">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">Base de conhecimento</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/vagas" className="text-muted-foreground hover:underline">
              Vagas
            </Link>
            <Link href="/candidaturas" className="text-muted-foreground hover:underline">
              Candidaturas
            </Link>
            <Link href="/" className="text-muted-foreground hover:underline">
              ← AutoApply
            </Link>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 border-b pb-2">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="hover:bg-muted rounded-md px-3 py-1.5 text-sm font-medium">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main>{children}</main>
      <Toaster richColors closeButton />
    </div>
  );
}
