import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { Link, getPathname } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { buttonClasses } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "meta" });
  return { title: { absolute: t("title") }, description: t("description") };
}

// Örnek profiller (tasarim/02). Gerçek kullanıcı değildir.
const EXAMPLES = [
  { initial: "E", name: "Elif", tr: "Çankaya, satranç", en: "Çankaya, chess", bg: "#FF6B57", rotate: "-rotate-3", offset: "" },
  { initial: "M", name: "Mert", tr: "Beşiktaş, basketbol", en: "Beşiktaş, basketball", bg: "#CDB8FF", rotate: "rotate-2", offset: "sm:translate-y-4" },
  { initial: "Z", name: "Zeynep", tr: "Kadıköy, fotoğraf", en: "Kadıköy, photography", bg: "#F6F1FF", rotate: "-rotate-2", offset: "" },
  { initial: "C", name: "Can", tr: "Bornova, müzik", en: "Bornova, music", bg: "#FF6B57", rotate: "rotate-3", offset: "sm:translate-y-3" },
];

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "landing" });
  const signupAction = getPathname({ href: "/signup", locale });

  return (
    <div className="overflow-x-clip bg-night">
      {/* Üst çubuk */}
      <header className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 px-4 py-5 sm:px-6 lg:py-6">
        <Link href="/" aria-label="Sohby">
          <Logo className="text-[22px]" markClassName="h-7 w-8" />
        </Link>
        <nav className="flex items-center gap-2 sm:gap-6">
          <a href="#how" className="hidden text-[15px] hover:text-lilac md:inline">
            {t("howItWorks")}
          </a>
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <Link href="/login" className="whitespace-nowrap px-2 text-[15px] hover:text-lilac">
            {t("login")}
          </Link>
          <Link href="/signup" className={buttonClasses({ size: "md", className: "h-11 px-5" })}>
            {t("join")}
          </Link>
        </nav>
      </header>

      {/* Kahraman alanı */}
      <section className="px-4 pb-20 pt-12 text-center sm:px-6 sm:pt-20 lg:pb-24 lg:pt-24">
        <h1 className="mx-auto max-w-[1000px] text-[48px] font-extrabold leading-[0.98] tracking-[-0.065em] sm:text-[76px] lg:text-[88px]">
          {t("headline")}
        </h1>
        <p className="mx-auto mt-8 max-w-[520px] text-lg leading-relaxed text-muted sm:text-xl">{t("subtitle")}</p>

        <form action={signupAction} method="get" className="mx-auto mt-10 flex max-w-[560px] flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">{t("emailPlaceholder")}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className={cn(inputClasses, "h-[54px] rounded-full px-6")}
            />
          </label>
          <button type="submit" className={buttonClasses({ size: "lg", className: "h-[54px] px-7" })}>
            {t("cta")}
          </button>
        </form>
        <p className="mt-6 text-sm text-muted">{t("ageNote")}</p>

        <ul aria-label={t("examplesLabel")} className="mx-auto mt-14 grid max-w-[860px] grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:justify-center sm:gap-4">
          {EXAMPLES.map((e) => (
            <li
              key={e.name}
              className={cn(
                "flex items-center gap-3 rounded-full border border-line bg-surface/60 py-2 pl-2 pr-5 text-left",
                e.rotate,
                e.offset,
              )}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-bold text-ink" style={{ background: e.bg }}>
                {e.initial}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{e.name}</span>
                <span className="block truncate text-[13px] text-muted">{locale === "tr" ? e.tr : e.en}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Nasıl çalışır */}
      <section id="how" className="scroll-mt-4 rounded-t-[40px] bg-[#f4f0ff] text-ink">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16">
            <h2 className="text-[40px] font-extrabold leading-[1.02] tracking-[-0.055em] lg:text-[52px]">{t("stepsTitle")}</h2>
            <ol className="border-t border-ink/15">
              {(["1", "2", "3"] as const).map((n) => (
                <li key={n} className="flex gap-6 border-b border-ink/15 py-7 sm:gap-8">
                  <span className="w-10 shrink-0 text-[28px] font-extrabold leading-none text-coral-ink">0{n}</span>
                  <span>
                    <span className="block text-xl font-semibold tracking-[-0.02em]">{t(`steps.${n}.title`)}</span>
                    <span className="mt-1.5 block leading-relaxed text-[#5d4e7a]">{t(`steps.${n}.body`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-20 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {(["adult", "private", "safety"] as const).map((k) => (
              <div key={k}>
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{t(`features.${k}.title`)}</h3>
                <p className="mt-2 leading-relaxed text-[#5d4e7a]">{t(`features.${k}.body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Alt bilgi */}
      <footer className="bg-night-deeper">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-6">
            <Logo withMark={false} className="text-xl" />
            <span className="text-sm text-muted">{t("footer.copyright", { year: new Date().getFullYear() })}</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <Link href="/legal/privacy-policy" className="hover:text-moon">
              {t("footer.privacy")}
            </Link>
            <Link href="/legal/privacy" className="hover:text-moon">
              {t("footer.kvkk")}
            </Link>
            <Link href="/legal/contact" className="hover:text-moon">
              {t("footer.contact")}
            </Link>
          </nav>
          <div className="sm:hidden">
            <LanguageSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
