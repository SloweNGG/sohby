import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { AuthHeading, AuthShell, OrDivider } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { GoogleButton } from "@/components/auth/google-button";
import { isValidEmail } from "@/lib/validation/auth";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth.signup" });
  return { title: t("metaTitle") };
}

export default async function SignupPage({ params, searchParams }: PageProps<"/[locale]/signup">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  const sp = await searchParams;
  const email = typeof sp.email === "string" && isValidEmail(sp.email) ? sp.email : "";

  return (
    <AuthShell
      headline={t("aside.signupHeadline")}
      bubbleThem={t("aside.signupBubbleThem")}
      bubbleMe={t("aside.signupBubbleMe")}
      footnote={t("aside.signupFootnote")}
    >
      <AuthHeading title={t("signup.title")} subtitle={t("signup.subtitle")} />
      <SignupForm initialEmail={email} />
      <OrDivider label={(await getTranslations({ locale, namespace: "common" }))("or")} />
      <GoogleButton label={t("signup.google")} next="/onboarding" />
      <p className="mt-6 text-center text-sm text-muted">
        {t("signup.haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-lilac hover:underline">
          {t("signup.loginLink")}
        </Link>
      </p>
    </AuthShell>
  );
}
