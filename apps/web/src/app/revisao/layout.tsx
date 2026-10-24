import { SiteLinks } from "@/components/site-links";

export default function ReviewLayout({ children }: LayoutProps<"/revisao">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between gap-4 border-b pb-3">
        <h1 className="text-2xl font-semibold">Revisão</h1>
        <SiteLinks current="/revisao" />
      </header>
      <main>{children}</main>
    </div>
  );
}
