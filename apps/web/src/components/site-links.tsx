import Link from "next/link";

/** Top-level sections shown in every section header (the current one is left out). */
const SECTIONS = [
  ["/vagas", "Vagas"],
  ["/candidaturas", "Candidaturas"],
  ["/revisao", "Revisão"],
  ["/noite", "Noite"],
  ["/memoria", "Memória"],
  ["/plataformas", "Plataformas"],
  ["/conhecimento", "Base de conhecimento"],
] as const;

export type SectionHref = (typeof SECTIONS)[number][0];

export function SiteLinks({ current }: { current?: SectionHref }) {
  return (
    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
      {SECTIONS.filter(([href]) => href !== current).map(([href, label]) => (
        <Link key={href} href={href} className="text-muted-foreground hover:underline">
          {label}
        </Link>
      ))}
      <Link href="/" className="text-muted-foreground hover:underline">
        ← AutoApply
      </Link>
    </div>
  );
}
