import { SiteLinks } from "@/components/site-links";

export default function AnalyticsLayout({ children }: LayoutProps<"/analises">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between gap-4 border-b pb-3">
        <h1 className="text-2xl font-semibold">Análises</h1>
        <SiteLinks current="/analises" />
      </header>
      <main>{children}</main>
    </div>
  );
}
