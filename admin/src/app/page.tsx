import Link from "next/link";
import { getT } from "@/lib/i18n";
import { adminRpc } from "@/lib/supabase";
import { AdminShell } from "@/components/shell";

type Overview = {
  pending: { reports: number; photos: number; age_documents: number; appeals: number };
  users: {
    total: number; new_today: number; new_7d: number; new_prev_7d: number; active_7d: number;
    suspended: number; closed: number; age_verification_required: number;
  };
  activity: { messages_24h: number; conversations_24h: number; reports_7d: number };
};

type Result<T> = ReturnType<typeof adminRpc<T>>;

export default async function OverviewPage() {
  // admin_overview yalnızca toplam sayılar döndürür; ekranın açılması kayda yazılır.
  // Yönetici kontrolüyle aynı anda başlar (bkz. adminRpc).
  const overview = adminRpc<Overview>("admin_overview");
  return (
    <AdminShell>
      <OverviewContent overview={overview} />
    </AdminShell>
  );
}

async function OverviewContent({ overview }: { overview: Result<Overview> }) {
  const { t, locale } = getT();
  const { data, error } = await overview;
  if (error || !data) return <p className="text-muted">{t("common.error")}</p>;
  const o = data;
  const n = (v: number) => new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR").format(v);

  const pending = [
    { href: "/reports", label: t("overview.pendingReports"), value: o.pending.reports },
    { href: "/photos", label: t("overview.pendingPhotos"), value: o.pending.photos },
    { href: "/age-documents", label: t("overview.pendingAgeDocs"), value: o.pending.age_documents },
    { href: "/appeals", label: t("overview.pendingAppeals"), value: o.pending.appeals },
  ];
  const allClear = pending.every((p) => p.value === 0);

  return (
    <div className="max-w-5xl space-y-10">
      <h1 className="text-2xl">{t("overview.title")}</h1>

      <section aria-labelledby="ov-pending">
        <h2 id="ov-pending" className="text-lg">{t("overview.pending")}</h2>
        {allClear && <p className="mt-1 text-sm text-muted">{t("overview.allClear")}</p>}
        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {pending.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className={
                  "block h-full rounded-[20px] border bg-surface p-4 hover:border-lilac " +
                  (p.value > 0 ? "border-coral" : "border-edge")
                }
              >
                <span className="flex items-center gap-2 text-sm text-muted">
                  {p.value > 0 && <span aria-hidden className="size-2 rounded-full bg-coral" />}
                  {p.label}
                </span>
                <span className="mt-2 block text-3xl font-semibold">{n(p.value)}</span>
                <span className="mt-1 block text-xs text-lilac">{t("overview.open")} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ov-users">
        <h2 id="ov-users" className="text-lg">{t("overview.users")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={t("overview.totalUsers")} value={n(o.users.total)} />
          <Tile label={t("overview.newToday")} value={n(o.users.new_today)} />
          <Tile
            label={t("overview.new7d")}
            value={n(o.users.new_7d)}
            note={t("overview.prev7d", { count: n(o.users.new_prev_7d) })}
          />
          <Tile label={t("overview.active7d")} value={n(o.users.active_7d)} />
        </ul>
        <p className="mt-2 text-xs text-muted">{t("overview.usersHint")}</p>
      </section>

      <section aria-labelledby="ov-status">
        <h2 id="ov-status" className="text-lg">{t("overview.accountStatus")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={t("accountStatus.suspended")} value={n(o.users.suspended)} href="/users?status=suspended" linkLabel={t("overview.list")} />
          <Tile label={t("accountStatus.closed")} value={n(o.users.closed)} href="/users?status=closed" linkLabel={t("overview.list")} />
          <Tile
            label={t("accountStatus.age_verification_required")}
            value={n(o.users.age_verification_required)}
            href="/users?status=age_verification_required"
            linkLabel={t("overview.list")}
          />
        </ul>
      </section>

      <section aria-labelledby="ov-activity">
        <h2 id="ov-activity" className="text-lg">{t("overview.activity")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={t("overview.messages24h")} value={n(o.activity.messages_24h)} />
          <Tile label={t("overview.conversations24h")} value={n(o.activity.conversations_24h)} />
          <Tile label={t("overview.reports7d")} value={n(o.activity.reports_7d)} />
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, note, href, linkLabel }: { label: string; value: string; note?: string; href?: string; linkLabel?: string }) {
  const body = (
    <>
      <span className="block text-sm text-muted">{label}</span>
      <span className="mt-2 block text-3xl font-semibold">{value}</span>
      {note && <span className="mt-1 block text-xs text-muted">{note}</span>}
      {href && linkLabel && <span className="mt-1 block text-xs text-lilac">{linkLabel} →</span>}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block h-full rounded-[20px] border border-edge bg-surface p-4 hover:border-lilac">{body}</Link>
      ) : (
        <div className="h-full rounded-[20px] border border-edge bg-surface p-4">{body}</div>
      )}
    </li>
  );
}
