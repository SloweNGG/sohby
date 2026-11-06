import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { AdminShell, Badge, btn } from "@/components/shell";

type Brief = { id: string; username: string; display_name: string | null; account_status: string; deleted_at: string | null } | null;
type Row = {
  id: string; reason: string; note: string | null; status: string; created_at: string; is_anonymous: boolean;
  reporter: Brief; reported: Brief; reported_open_reports: number;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { t } = getT();
  const { status } = await searchParams;
  const filter = status === "all" ? "all" : "open";
  return (
    <AdminShell>
      <ReportsTable filter={filter} t={t} />
    </AdminShell>
  );
}

async function ReportsTable({ filter, t }: { filter: "open" | "all"; t: ReturnType<typeof getT>["t"] }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_reports", { p_status: filter });
  const rows = (data ?? []) as Row[];
  const name = (b: Brief) => (b ? `@${b.username}${b.deleted_at ? ` (${t("common.deleted")})` : ""}` : "—");
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl">{t("reports.title")}</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/reports" className={btn}>{t("reports.open")}</Link>
          <Link href="/reports?status=all" className={btn}>{t("reports.all")}</Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted">{t("common.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4">{t("common.date")}</th>
                <th className="py-2 pr-4">{t("reports.reason")}</th>
                <th className="py-2 pr-4">{t("reports.reported")}</th>
                <th className="py-2 pr-4">{t("reports.reporter")}</th>
                <th className="py-2 pr-4">{t("common.status")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4">
                    {t(`reasons.${r.reason}`)} {r.is_anonymous && <Badge>{t("reports.anonymous")}</Badge>}
                  </td>
                  <td className="py-2 pr-4">
                    {name(r.reported)} <span className="text-muted">({t("reports.openCount", { count: r.reported_open_reports })})</span>
                  </td>
                  <td className="py-2 pr-4">{name(r.reporter)}</td>
                  <td className="py-2 pr-4">{t(`reportStatus.${r.status}`)}</td>
                  <td className="py-2"><Link href={`/reports/${r.id}`} className={btn}>{t("reports.view")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
