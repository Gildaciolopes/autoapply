import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ControlBar } from "@/components/control/control-bar";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoApply",
  description: "Aplicador automático de vagas com IA local",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Global kill switch (F6): visible on every page. */}
        <div className="bg-muted/40 border-b">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-6 py-2 text-sm">
            <Link href="/" className="font-semibold">
              AutoApply
            </Link>
            <ControlBar />
          </div>
        </div>
        {children}
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
