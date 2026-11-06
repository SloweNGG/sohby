import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "@/components/auth/reset-form";
import { FormAlert } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { getCurrentUserId } from "@/lib/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth.reset" });
  return { title: t("metaTitle") };
}

export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  const userId = await getCurrentUserId();

  return (
    <AuthShell
      centered
      headline={t("aside.resetHeadline")}
      bubbleThem={t("aside.resetBubbleThem")}
      bubbleMe={t("aside.resetBubbleMe")}
    >
      <AuthHeading title={t("reset.title")} subtitle={t("reset.subtitle")} />
      {userId ? (
        <ResetForm />
      ) : (
        <div className="space-y-5">
          <FormAlert>{t("reset.noSession")}</FormAlert>
          <Link href="/forgot-password" className={buttonClasses({ size: "lg", full: true })}>
            {t("reset.requestNew")}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
