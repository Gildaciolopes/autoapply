import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";

export default function ApplicationsLayout({ children }: LayoutProps<"/candidaturas">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between gap-4 border-b pb-3">
        <h1 className="text-2xl font-semibold">Candidaturas</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/vagas" className="text-muted-foreground hover:underline">
            Vagas
          </Link>
          <Link href="/plataformas" className="text-muted-foreground hover:underline">
            Plataformas
          </Link>
          <Link href="/conhecimento" className="text-muted-foreground hover:underline">
            Base de conhecimento
          </Link>
          <Link href="/" className="text-muted-foreground hover:underline">
            ← AutoApply
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <Toaster richColors closeButton />
    </div>
  );
}
