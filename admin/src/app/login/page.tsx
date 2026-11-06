import { getT } from "@/lib/i18n";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const { t } = getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-3xl">{t("login.title")}</h1>
      <LoginForm
        labels={{
          email: t("login.email"),
          password: t("login.password"),
          submit: t("login.submit"),
          login: t("login.error"),
          notAdmin: t("login.notAdmin"),
        }}
      />
    </main>
  );
}
