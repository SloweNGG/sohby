import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { resolveReportAction, setUserStatusAction } from "@/lib/actions";
import { AdminShell, Badge, btn, btnDanger, btnPrimary } from "@/components/shell";

type Brief = { id: string; username: string; display_name: string | null; account_status: string } | null;
type Report = {
  id: string; reason: string; note: string | null; status: string; created_at: string; is_anonymous: boolean;
  reporter: Brief; reported: Brief; messages: Array<{ sender_id: string; body: string; created_at: string }>;
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <ReportDetail id={id} />
    </AdminShell>
  );
}

async function ReportDetail({ id }: { id: string }) {
  const { t } = getT();
  const supabase = await createClient();
  // admin_get_report sohbet görüntülemesini işlem kaydına yazar (kural 14).
  const { data } = await supabase.rpc("admin_get_report", { p_report: id });
  const r = data as Report | null;
  if (!r) return <p className="text-muted">{t("common.none")}</p>;
  const who = (senderId: string) =>
    senderId === r.reported?.id ? `@${r.reported.username}` : senderId === r.reporter?.id ? `@${r.reporter.username}` : senderId;

  return (
    <section className="max-w-3xl">
      <Link href="/reports" className="text-sm text-muted hover:text-moon">← {t("common.back")}</Link>
      <h1 className="mt-3 text-2xl">
        {t(`reasons.${r.reason}`)} {r.is_anonymous && <Badge>{t("reports.anonymous")}</Badge>}
      </h1>
      <dl className="mt-4 grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("reports.reported")}</dt><dd>@{r.reported?.username} · {t(`accountStatus.${r.reported?.account_status ?? "active"}`)}</dd>
        <dt className="text-muted">{t("reports.reporter")}</dt><dd>@{r.reporter?.username ?? "—"}</dd>
        <dt className="text-muted">{t("common.status")}</dt><dd>{t(`reportStatus.${r.status}`)}</dd>
        <dt className="text-muted">{t("reports.note")}</dt><dd className="whitespace-pre-wrap">{r.note ?? "—"}</dd>
      </dl>

      <h2 className="mt-8 text-lg">{t("reports.messages")}</h2>
      {r.messages.length === 0 ? (
        <p className="text-sm text-muted">{t("reports.noMessages")}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">{t("reports.viewLogged")}</p>
          <ol className="space-y-2 rounded-2xl border border-edge bg-night-deep p-4 text-sm">
            {r.messages.map((m, i) => (
              <li key={i}>
                <span className="text-muted">{new Date(m.created_at).toLocaleString()} · {who(m.sender_id)}:</span>{" "}
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {(["reviewing", "resolved", "dismissed"] as const).map((s) => (
          <form key={s} action={resolveReportAction}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value={s} />
            <button className={s === "resolved" ? btnPrimary : btn}>
              {t(s === "reviewing" ? "reports.reviewing" : s === "resolved" ? "reports.resolve" : "reports.dismiss")}
            </button>
          </form>
        ))}
        {r.reported && (
          <>
            <form action={setUserStatusAction}>
              <input type="hidden" name="user" value={r.reported.id} />
              <input type="hidden" name="status" value="suspended" />
              <input type="hidden" name="days" value="7" />
              <input type="hidden" name="reason" value={t(`reasons.${r.reason}`)} />
              <input type="hidden" name="back" value={`/reports/${r.id}`} />
              <button className={btnDanger}>{t("reports.suspend7")}</button>
            </form>
            <form action={setUserStatusAction}>
              <input type="hidden" name="user" value={r.reported.id} />
              <input type="hidden" name="status" value="closed" />
              <input type="hidden" name="reason" value={t(`reasons.${r.reason}`)} />
              <input type="hidden" name="back" value={`/reports/${r.id}`} />
              <button className={btnDanger}>{t("reports.close")}</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
