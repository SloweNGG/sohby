import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { reviewAgeDocumentAction } from "@/lib/actions";
import { AdminShell, Badge, btnDanger, btnPrimary, input } from "@/components/shell";
import { AgeDocViewer } from "@/components/age-doc-viewer";

type Doc = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
  delete_after: string;
  reviewed_at: string | null;
  review_note: string | null;
  file_available: boolean;
  user: { username: string; display_name: string | null; birth_date: string | null } | null;
};

function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

export default async function AgeDocumentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return (
    <AdminShell>
      <AgeDocuments status={status === "all" ? "all" : "pending"} />
    </AdminShell>
  );
}

async function AgeDocuments({ status }: { status: "pending" | "all" }) {
  const { t } = getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_age_documents", { p_status: status });
  const rows = (data ?? []) as Doc[];
  const tab = (active: boolean) =>
    "rounded-full px-3 py-1.5 text-sm " + (active ? "bg-coral font-semibold text-ink" : "border border-edge hover:bg-surface");

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl">{t("ageDocs.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("ageDocs.hint")}</p>
      <nav className="mt-4 flex gap-2" aria-label={t("ageDocs.title")}>
        <Link href="/age-documents" className={tab(status === "pending")} aria-current={status === "pending" ? "page" : undefined}>
          {t("ageDocs.tabPending")}
        </Link>
        <Link href="/age-documents?status=all" className={tab(status === "all")} aria-current={status === "all" ? "page" : undefined}>
          {t("ageDocs.tabAll")}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{t("ageDocs.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((d) => {
            const age = ageFrom(d.user?.birth_date ?? null);
            return (
              <li key={d.id} className="space-y-3 rounded-[20px] border border-edge bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">@{d.user?.username}</span>
                  {d.user?.display_name && <span className="text-muted">{d.user.display_name}</span>}
                  <Badge>{t(`ageDocs.status.${d.status}`)}</Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">{t("ageDocs.birthDate")}</dt>
                  <dd>
                    {d.user?.birth_date ?? "—"}
                    {age !== null && ` · ${t("ageDocs.age", { age })}`}
                  </dd>
                  <dt className="text-muted">{t("ageDocs.uploaded")}</dt>
                  <dd>{new Date(d.created_at).toLocaleString()}</dd>
                  <dt className="text-muted">{t("ageDocs.deleteAfter")}</dt>
                  <dd>{new Date(d.delete_after).toLocaleString()}</dd>
                </dl>
                {d.review_note && <p className="text-sm text-muted">{d.review_note}</p>}
                {d.file_available ? (
                  <AgeDocViewer
                    documentId={d.id}
                    labels={{
                      show: t("ageDocs.show"),
                      hide: t("ageDocs.hide"),
                      error: t("ageDocs.openError"),
                      notAvailable: t("ageDocs.notAvailable"),
                      alt: `@${d.user?.username ?? ""}`,
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted">{t("ageDocs.notAvailable")}</p>
                )}
                {d.status === "pending" && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <div className="flex flex-wrap gap-2">
                      <form action={reviewAgeDocumentAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="approve" value="1" />
                        <button className={btnPrimary}>{t("ageDocs.approve")}</button>
                      </form>
                    </div>
                    <form action={reviewAgeDocumentAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="approve" value="0" />
                      <label className="min-w-0 flex-1">
                        <span className="sr-only">{t("ageDocs.notePlaceholder")}</span>
                        <input name="note" maxLength={500} placeholder={t("ageDocs.notePlaceholder")} className={`${input} w-full`} />
                      </label>
                      <button className={btnDanger}>{t("ageDocs.reject")}</button>
                    </form>
                    <p className="text-xs text-muted">{t("ageDocs.underageHint")}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
