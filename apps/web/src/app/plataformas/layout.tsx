import { SiteLinks } from "@/components/site-links";

export default function PlatformsLayout({ children }: LayoutProps<"/plataformas">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between gap-4 border-b pb-3">
        <h1 className="text-2xl font-semibold">Plataformas</h1>
        <SiteLinks current="/plataformas" />
      </header>
      <main>{children}</main>
    </div>
  );
}
