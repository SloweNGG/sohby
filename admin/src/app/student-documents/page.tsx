import Link from "next/link";
import { getT } from "@/lib/i18n";
import { ageFrom, fmtDateTime } from "@/lib/format";
import { adminRpc } from "@/lib/supabase";
import { reviewStudentDocumentAction, revokeStudentAction } from "@/lib/actions";
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
  university: { id: string; name: string };
  user: { id: string; username: string; display_name: string | null; birth_date: string | null } | null;
};

/** Kampüs: öğrenci kartı incelemesi (kural 16). */
export default async function StudentDocumentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = status === "all" ? "all" : "pending";
  const docs = adminRpc<Doc[]>("admin_list_student_documents", { p_status: filter });
  return (
    <AdminShell>
      <StudentDocuments status={filter} docs={docs} />
    </AdminShell>
  );
}

async function StudentDocuments({ status, docs }: { status: "pending" | "all"; docs: ReturnType<typeof adminRpc<Doc[]>> }) {
  const { t } = getT();
  const rows = (await docs).data ?? [];
  const tab = (active: boolean) =>
    "rounded-full px-3 py-1.5 text-sm " + (active ? "bg-coral font-semibold text-ink" : "border border-edge hover:bg-surface");

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl">{t("studentDocs.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("studentDocs.hint")}</p>
      <nav className="mt-4 flex gap-2" aria-label={t("studentDocs.title")}>
        <Link href="/student-documents" className={tab(status === "pending")} aria-current={status === "pending" ? "page" : undefined}>
          {t("studentDocs.tabPending")}
        </Link>
        <Link
          href="/student-documents?status=all"
          className={tab(status === "all")}
          aria-current={status === "all" ? "page" : undefined}
        >
          {t("studentDocs.tabAll")}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{t("studentDocs.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((d) => {
            const age = ageFrom(d.user?.birth_date ?? null);
            return (
              <li key={d.id} className="space-y-3 rounded-[20px] border border-edge bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {d.user ? (
                    <Link href={`/users/${d.user.id}`} className="font-semibold underline-offset-2 hover:underline">
                      @{d.user.username}
                    </Link>
                  ) : (
                    <span className="font-semibold">—</span>
                  )}
                  {d.user?.display_name && <span className="text-muted">{d.user.display_name}</span>}
                  <Badge>{t(`studentDocs.status.${d.status}`)}</Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">{t("studentDocs.university")}</dt>
                  <dd>{d.university.name}</dd>
                  <dt className="text-muted">{t("studentDocs.profileName")}</dt>
                  <dd>
                    {d.user?.display_name ?? "—"}
                    {age !== null && ` · ${t("studentDocs.age", { age })}`}
                  </dd>
                  <dt className="text-muted">{t("studentDocs.uploaded")}</dt>
                  <dd>{fmtDateTime(d.created_at)}</dd>
                  <dt className="text-muted">{t("studentDocs.deleteAfter")}</dt>
                  <dd>{fmtDateTime(d.delete_after)}</dd>
                </dl>
                {d.review_note && <p className="text-sm text-muted">{d.review_note}</p>}
                {d.file_available ? (
                  <AgeDocViewer
                    kind="student"
                    documentId={d.id}
                    labels={{
                      show: t("studentDocs.show"),
                      hide: t("studentDocs.hide"),
                      error: t("studentDocs.openError"),
                      notAvailable: t("studentDocs.notAvailable"),
                      alt: `@${d.user?.username ?? ""}`,
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted">{t("studentDocs.notAvailable")}</p>
                )}
                {d.status === "pending" && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
                      <li>{t("studentDocs.check1")}</li>
                      <li>{t("studentDocs.check2")}</li>
                      <li>{t("studentDocs.check3")}</li>
                    </ul>
                    <form action={reviewStudentDocumentAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="approve" value="1" />
                      <button className={btnPrimary}>{t("studentDocs.approve")}</button>
                    </form>
                    <form action={reviewStudentDocumentAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="approve" value="0" />
                      <label className="min-w-0 flex-1">
                        <span className="sr-only">{t("studentDocs.notePlaceholder")}</span>
                        <input
                          name="note"
                          required
                          maxLength={500}
                          placeholder={t("studentDocs.notePlaceholder")}
                          className={`${input} w-full`}
                        />
                      </label>
                      <button className={btnDanger}>{t("studentDocs.reject")}</button>
                    </form>
                  </div>
                )}
                {d.status === "approved" && d.user && (
                  <form action={revokeStudentAction} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <input type="hidden" name="user" value={d.user.id} />
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">{t("studentDocs.revokePlaceholder")}</span>
                      <input
                        name="note"
                        required
                        maxLength={500}
                        placeholder={t("studentDocs.revokePlaceholder")}
                        className={`${input} w-full`}
                      />
                    </label>
                    <button className={btnDanger}>{t("studentDocs.revoke")}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
