import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "@/components/auth/forgot-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth.forgot" });
  return { title: t("metaTitle") };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <AuthShell
      centered
      headline={t("aside.resetHeadline")}
      bubbleThem={t("aside.resetBubbleThem")}
      bubbleMe={t("aside.resetBubbleMe")}
    >
      <AuthHeading title={t("forgot.title")} subtitle={t("forgot.subtitle")} />
      <ForgotForm />
      <Link href="/login" className="mt-6 inline-flex items-center gap-1 self-center text-sm text-muted hover:text-moon">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {t("forgot.back")}
      </Link>
    </AuthShell>
  );
}
