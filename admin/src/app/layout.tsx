import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { getT } from "@/lib/i18n";
import "./globals.css";

const sora = Sora({ variable: "--font-sora", subsets: ["latin", "latin-ext"], weight: ["400", "600", "800"] });

export function generateMetadata(): Metadata {
  const { t } = getT();
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = getT();
  return (
    <html lang={locale} className={`${sora.variable} h-full antialiased`}>
      <body className="min-h-full bg-night text-moon">{children}</body>
    </html>
  );
}
