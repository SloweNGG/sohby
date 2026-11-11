import Link from "next/link";
import { getT } from "@/lib/i18n";
import { getAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase";
import { NavLinks, type NavItem } from "./nav-links";

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
  // Bekleyen iş sayıları (yalnızca toplamlar). Fonksiyon henüz yoksa ya da hata verirse rozetler gizlenir.
  const supabase = await createClient();
  const { data: counts } = await supabase.rpc("admin_nav_counts");
  const c = (counts ?? {}) as Partial<Record<"reports" | "photos" | "age_documents" | "appeals", number>>;
  const pending = t("nav.pending");
  const items: NavItem[] = [
    { href: "/", label: t("nav.overview") },
    { href: "/reports", label: t("nav.reports"), count: c.reports, countLabel: pending },
    { href: "/photos", label: t("nav.photos"), count: c.photos, countLabel: pending },
    { href: "/age-documents", label: t("nav.ageDocuments"), count: c.age_documents, countLabel: pending },
    { href: "/users", label: t("nav.users") },
    { href: "/appeals", label: t("nav.appeals"), count: c.appeals, countLabel: pending },
    { href: "/audit", label: t("nav.audit") },
    { href: "/settings", label: t("nav.settings") },
  ];
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <nav aria-label={t("title")} className="border-b border-line bg-night-deep p-4 md:min-h-dvh md:border-b-0 md:border-r">
        <Link href="/" className="mb-6 block text-lg font-extrabold">{t("title")}</Link>
        <NavLinks items={items} />
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
