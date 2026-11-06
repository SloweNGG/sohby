"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-edge p-1 pl-3",
        pending && "opacity-70",
        className,
      )}
    >
      <Globe className="mr-1 h-4 w-4 text-muted" aria-hidden="true" />
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === locale}
          onClick={() =>
            startTransition(() => {
              const search = typeof window !== "undefined" ? window.location.search : "";
              router.replace(`${pathname}${search}`, { locale: l });
            })
          }
          className={cn(
            "h-7 min-w-10 rounded-full px-3 text-xs font-bold uppercase transition-colors",
            l === locale ? "bg-moon text-ink" : "text-moon hover:bg-surface",
          )}
        >
          {t(`localeShort.${l}`)}
        </button>
      ))}
    </div>
  );
}
