import Link from "next/link";
import { getT } from "@/lib/i18n";
import { adminRpc } from "@/lib/supabase";
import { AdminShell, btn, input } from "@/components/shell";
import { fmtDate } from "@/lib/format";

type U = {
  id: string; username: string; display_name: string | null; email: string | null; account_status: string;
  status_reason: string | null; suspended_until: string | null; deleted_at: string | null; created_at: string; report_count: number;
};
const STATUSES = ["active", "age_verification_required", "suspended", "closed"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const status = STATUSES.find((s) => s === sp.status) ?? null;
  const users = adminRpc<U[]>("admin_list_users", { p_search: q || null, p_status: status, p_limit: 100, p_offset: 0 });
  return (
    <AdminShell>
      <Users q={q} status={status} users={users} />
    </AdminShell>
  );
}

async function Users({ q, status, users }: { q: string; status: string | null; users: ReturnType<typeof adminRpc<U[]>> }) {
  const { t } = getT();
  const rows = (await users).data ?? [];
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
            <li key={u.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/users/${u.id}`} className="font-semibold text-lilac underline-offset-4 hover:underline">@{u.username}</Link>
                <span className="text-muted">{u.display_name}</span>
                <span className="text-sm text-muted">{u.email}</span>
                <span className="text-sm">{t(`accountStatus.${u.account_status}`)}{u.deleted_at ? ` · ${t("common.deleted")}` : ""}</span>
                <span className="text-sm text-muted">{t("users.reports")}: {u.report_count}</span>
                <span className="text-sm text-muted">{t("users.joined")}: {fmtDate(u.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
