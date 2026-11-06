import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { AuthHeading, AuthShell, OrDivider } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { GoogleButton } from "@/components/auth/google-button";
import { safeNextPath } from "@/lib/safe-redirect";
import type { AuthErrorCode } from "@/lib/auth/types";

const LINK_ERRORS: AuthErrorCode[] = ["link_invalid", "config", "oauth_failed"];

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth.login" });
  return { title: t("metaTitle") };
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next) : undefined;
  const error = LINK_ERRORS.find((e) => e === sp.error);

  return (
    <AuthShell
      centered
      headline={t("aside.loginHeadline")}
      bubbleThem={t("aside.loginBubbleThem")}
      bubbleMe={t("aside.loginBubbleMe")}
    >
      <AuthHeading title={t("login.title")} subtitle={t("login.subtitle")} />
      <LoginForm next={next} initialError={error} />
      <OrDivider label={tc("or")} />
      <GoogleButton label={t("login.google")} next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        {t("login.noAccount")}{" "}
        <Link href="/signup" className="font-semibold text-lilac hover:underline">
          {t("login.signupLink")}
        </Link>
      </p>
    </AuthShell>
  );
}
