import Link from "next/link";
import { getT } from "@/lib/i18n";
import { getAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";

/** Yönetim sayfalarının ortak iskeleti. Yönetici değilse içerik gösterilmez. */
export async function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = getT();
  const { ok } = await getAdmin();
  if (!ok) {
    return (
      <main className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-3xl">{t("forbidden.title")}</h1>
        <p className="mt-2 text-muted">{t("forbidden.body")}</p>
        <form action={logoutAction} className="mt-6">
          <button className="rounded-full border border-edge px-5 py-2.5">{t("nav.signOut")}</button>
        </form>
      </main>
    );
  }
  const links = [
    ["/reports", t("nav.reports")],
    ["/photos", t("nav.photos")],
    ["/age-documents", t("nav.ageDocuments")],
    ["/users", t("nav.users")],
    ["/appeals", t("nav.appeals")],
    ["/audit", t("nav.audit")],
  ] as const;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <nav aria-label={t("title")} className="border-b border-line bg-night-deep p-4 md:min-h-dvh md:border-b-0 md:border-r">
        <p className="mb-6 text-lg font-extrabold">{t("title")}</p>
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {links.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="block rounded-xl px-3 py-2 text-sm hover:bg-surface">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <form action={logoutAction} className="mt-6">
          <button className="text-sm text-muted hover:text-moon">{t("nav.signOut")}</button>
        </form>
      </nav>
      <main className="p-4 md:p-8">
        <p className="mb-6 rounded-2xl border border-edge bg-surface px-4 py-2.5 text-xs text-muted">{t("auditNotice")}</p>
        {children}
      </main>
    </div>
  );
}

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-edge px-2 py-0.5 text-xs">{children}</span>;
}

export { btn, btnPrimary, btnDanger, input } from "./shell-classes";
