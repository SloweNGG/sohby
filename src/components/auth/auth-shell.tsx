import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";

type AuthShellProps = {
  headline: string;
  bubbleThem: string;
  bubbleMe: string;
  footnote?: string;
  children: ReactNode;
  /** Form dikeyde ortalansın mı (giriş) yoksa üstten mi başlasın (kayıt). */
  centered?: boolean;
};

/**
 * tasarim/03-kayit.png ve 04-giris.png: solda koyu marka paneli (başlık +
 * sohbet balonları), sağda form. Telefonda yalnızca üst çubuk + form.
 */
export function AuthShell({ headline, bubbleThem, bubbleMe, footnote, children, centered }: AuthShellProps) {
  const tCommon = useTranslations("common");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,686fr)_minmax(0,754fr)]">
      {/* Sol panel (masaüstü) */}
      <aside className="relative hidden flex-col bg-night-deep px-12 pb-12 pt-12 lg:flex">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label={tCommon("homeLink")}>
            <Logo className="text-[26px]" markClassName="h-8 w-9" />
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="max-w-[600px] text-[clamp(40px,3.9vw,56px)] font-extrabold leading-[1.04] tracking-[-0.06em]">
            {headline}
          </h1>
        </div>
        <div className="mb-16 flex flex-col items-start gap-3" aria-hidden="true">
          <span className="rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[15px] font-normal">
            {bubbleThem}
          </span>
          <span className="ml-[150px] rounded-2xl rounded-br-md bg-coral px-4 py-3 text-[15px] font-normal text-ink">
            {bubbleMe}
          </span>
        </div>
        {footnote ? <p className="max-w-[450px] text-[15px] leading-relaxed text-muted">{footnote}</p> : null}
      </aside>

      {/* Sağ panel */}
      <main className="flex min-h-dvh flex-col bg-night lg:min-h-0">
        <div className="flex items-center justify-between px-4 pt-5 sm:px-6 lg:hidden">
          <Link href="/" aria-label={tCommon("homeLink")}>
            <Logo className="text-[22px]" markClassName="h-7 w-8" />
          </Link>
          <LanguageSwitcher />
        </div>
        <div
          className={
            "mx-auto flex w-full max-w-[440px] flex-1 flex-col px-4 pb-12 sm:px-0 " +
            (centered ? "justify-center pt-10" : "pt-10 lg:pt-12")
          }
        >
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-6">
      <h2 className="text-[30px] font-extrabold leading-tight tracking-[-0.045em] sm:text-[34px]">{title}</h2>
      <p className="mt-1 text-base text-muted">{subtitle}</p>
    </header>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-sm text-muted">
      <span className="h-px flex-1 bg-line" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
