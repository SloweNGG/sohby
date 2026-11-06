import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { buttonClasses } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";

/** 18 yaş altı nedeniyle kilitlenen hesaplar için bilgi ekranı. */
export async function BlockedNotice({ withSignOut = false }: { withSignOut?: boolean }) {
  const t = await getTranslations("blocked");
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 text-center">
      <Logo className="mb-10 text-2xl" />
      <ShieldAlert className="mb-4 h-10 w-10 text-coral" aria-hidden="true" />
      <h1 className="text-3xl">{t("title")}</h1>
      <p className="mt-3 leading-relaxed text-muted">{t("body")}</p>
      {withSignOut ? (
        <form action={signOutAction} className="mt-8">
          <button type="submit" className={buttonClasses({ variant: "outline" })}>
            {t("home")}
          </button>
        </form>
      ) : (
        <Link href="/" className={buttonClasses({ variant: "outline", className: "mt-8" })}>
          {t("home")}
        </Link>
      )}
    </main>
  );
}
