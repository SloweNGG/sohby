import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

export type LegalDoc = "terms" | "kvkk" | "privacy" | "contact";

export const LEGAL_ROUTES: Record<LegalDoc, string> = {
  terms: "/legal/terms",
  kvkk: "/legal/privacy",
  privacy: "/legal/privacy-policy",
  contact: "/legal/contact",
};

type Section = { h: string; p?: string[]; items?: string[]; p2?: string[] };
type Doc = { title: string; intro: string; sections: Section[] };

/** Metindeki e-posta adreslerini tıklanabilir yapar. */
function linkify(text: string): ReactNode {
  const parts = text.split(/([\w.+-]+@[\w-]+\.[\w.]+)/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={`mailto:${part}`} className="text-lilac underline underline-offset-2">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Hukuki metin sayfası (metinler messages/*.json → legalDocs). */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = useTranslations("legalDocs");
  const tCommon = useTranslations("common");
  // Bölüm listesi iç içe bir nesne: tek tek anahtar yerine bütün belge okunur.
  const content = (t.raw as (key: string) => unknown)(doc) as Doc;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/" aria-label={tCommon("homeLink")}>
        <Logo className="text-2xl" />
      </Link>

      <nav aria-label={t("nav.terms")} className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {(Object.keys(LEGAL_ROUTES) as LegalDoc[]).map((d) => (
            <li key={d}>
              <Link
                href={LEGAL_ROUTES[d]}
                aria-current={d === doc ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors",
                  d === doc ? "border-coral bg-coral font-semibold text-ink" : "border-edge text-moon hover:bg-surface",
                )}
              >
                {t(`nav.${d}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="mt-8">
        <h1 className="text-4xl">{content.title}</h1>
        <p className="mt-2 text-sm text-muted">{t("updated")}</p>
        <p className="mt-6 leading-relaxed">{linkify(content.intro)}</p>
        {content.sections.map((s) => (
          <section key={s.h} className="mt-8">
            <h2 className="text-xl">{s.h}</h2>
            {s.p?.map((para, i) => (
              <p key={i} className="mt-3 leading-relaxed text-moon/90">
                {linkify(para)}
              </p>
            ))}
            {s.items && (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-moon/90 marker:text-lilac">
                {s.items.map((item, i) => (
                  <li key={i}>{linkify(item)}</li>
                ))}
              </ul>
            )}
            {s.p2?.map((para, i) => (
              <p key={i} className="mt-3 leading-relaxed text-moon/90">
                {linkify(para)}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
