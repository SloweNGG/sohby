import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { setUserStatusAction } from "@/lib/actions";
import { AdminShell, btn, input } from "@/components/shell";

type U = {
  id: string; username: string; display_name: string | null; email: string | null; account_status: string;
  status_reason: string | null; suspended_until: string | null; deleted_at: string | null; created_at: string; report_count: number;
};
const STATUSES = ["active", "age_verification_required", "suspended", "closed"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  return (
    <AdminShell>
      <Users q={sp.q ?? ""} status={STATUSES.find((s) => s === sp.status) ?? null} />
    </AdminShell>
  );
}

async function Users({ q, status }: { q: string; status: string | null }) {
  const { t } = getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_users", { p_search: q || null, p_status: status, p_limit: 100, p_offset: 0 });
  const rows = (data ?? []) as U[];
  return (
    <section>
      <h1 className="text-2xl">{t("users.title")}</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={q} placeholder={t("users.search")} aria-label={t("users.search")} className={`${input} w-72`} />
        <select name="status" defaultValue={status ?? ""} aria-label={t("users.filter")} className={input}>
          <option value="">{t("users.any")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`accountStatus.${s}`)}</option>)}
        </select>
        <button className={btn}>{t("users.apply")}</button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{t("common.none")}</p>
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {rows.map((u) => (
            <li key={u.id} className="py-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold">@{u.username}</span>
                <span className="text-muted">{u.display_name}</span>
                <span className="text-sm text-muted">{u.email}</span>
                <span className="text-sm">{t(`accountStatus.${u.account_status}`)}{u.deleted_at ? ` · ${t("common.deleted")}` : ""}</span>
                <span className="text-sm text-muted">{t("users.reports")}: {u.report_count}</span>
              </div>
              <form action={setUserStatusAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="user" value={u.id} />
                <select name="status" defaultValue={u.account_status} aria-label={t("users.setStatus")} className={input}>
                  {STATUSES.map((s) => <option key={s} value={s}>{t(`accountStatus.${s}`)}</option>)}
                </select>
                <input name="reason" defaultValue={u.status_reason ?? ""} placeholder={t("users.reason")} aria-label={t("users.reason")} maxLength={500} className={`${input} w-64`} />
                <input name="until" type="datetime-local" aria-label={t("users.until")} className={input} />
                <button className={btn}>{t("users.setStatus")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
