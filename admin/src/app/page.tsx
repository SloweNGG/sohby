import Link from "next/link";
import { Clock } from "lucide-react";
import { getT } from "@/lib/i18n";
import { adminRpc } from "@/lib/supabase";
import { fmtWaiting } from "@/lib/format";
import { AdminShell } from "@/components/shell";
import { DailyChart, type DailyPoint } from "@/components/charts/daily-chart";
import { BarList, Card, StatTile, delta, type BarRow } from "@/components/charts/figures";

type SeriesKey = "signups" | "messages" | "active" | "conversations" | "reports";
type Counts = Record<SeriesKey, number>;
type Queue = { count: number; oldest: string | null };
type Dashboard = {
  days: number;
  from: string;
  to: string;
  series: ({ day: string } & Counts)[];
  totals: Counts;
  previous: Counts;
  now: {
    users: number; active_7d: number; online: number; students: number;
    suspended: number; closed: number; age_verification_required: number; friendships: number;
  };
  funnel: { signed_up: number; email_verified: number; onboarded: number; messaged: number; mutual: number };
  retention: { eligible: number; returned: number };
  audience: {
    looking_for: Record<string, number>;
    gender: Record<string, number>;
    age: Record<string, number>;
    cities: { country: string; city: string; count: number }[];
  };
  requests: { sent: number; accepted: number; declined: number; pending: number };
  content: { photos: number; voice: number; anon_chats: number; friendships: number };
  queues: Record<"reports" | "photos" | "age_documents" | "student_documents" | "appeals", Queue>;
  report_reasons: Record<string, number>;
};

const PERIODS = [7, 30, 90] as const;
const AGE_BUCKETS = ["18-20", "21-24", "25-29", "30-39", "40+"];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  // admin_dashboard yalnızca toplam sayılar döndürür; ekranın açılması dönemle birlikte kayda yazılır.
  // Yönetici kontrolüyle aynı anda başlar (bkz. adminRpc).
  const dashboard = adminRpc<Dashboard>("admin_dashboard", { p_days: days });
  return (
    <AdminShell>
      <OverviewContent days={days} dashboard={dashboard} />
    </AdminShell>
  );
}

async function OverviewContent({ days, dashboard }: { days: number; dashboard: ReturnType<typeof adminRpc<Dashboard>> }) {
  const { t, locale } = getT();
  const { data: d, error } = await dashboard;
  if (error || !d) return <p className="text-muted">{t("common.error")}</p>;

  const intl = locale === "en" ? "en-GB" : "tr-TR";
  const nf = new Intl.NumberFormat(intl);
  const n = (v: number) => nf.format(v);
  const pct = (part: number, whole: number) => (whole > 0 ? t("dashboard.delta.pct", { n: Math.round((part / whole) * 100) }) : "—");
  const dayLabel = new Intl.DateTimeFormat(intl, { timeZone: "UTC", day: "numeric", month: "short" });
  const label = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));
  const points = (key: SeriesKey): DailyPoint[] => d.series.map((s) => ({ day: s.day, label: label(s.day), value: s[key] }));
  const trend = (key: SeriesKey) => d.series.map((s) => s[key]);
  const vs = t("dashboard.vsPrevious", { days });

  // Bekleyen işler: sayı + en eskisinin ne zamandır beklediği.
  const queues = [
    { key: "reports", href: "/reports", label: t("overview.pendingReports") },
    { key: "photos", href: "/photos", label: t("overview.pendingPhotos") },
    { key: "age_documents", href: "/age-documents", label: t("overview.pendingAgeDocs") },
    { key: "student_documents", href: "/student-documents", label: t("dashboard.pendingStudentDocs") },
    { key: "appeals", href: "/appeals", label: t("overview.pendingAppeals") },
  ] as const;
  const allClear = queues.every((q) => d.queues[q.key].count === 0);

  const kpis: { key: SeriesKey; upIsGood: boolean }[] = [
    { key: "signups", upIsGood: true },
    { key: "active", upIsGood: true },
    { key: "messages", upIsGood: true },
    { key: "conversations", upIsGood: true },
    { key: "reports", upIsGood: false },
  ];

  const f = d.funnel;
  const funnel: BarRow[] = [
    { key: "signed_up", label: t("dashboard.funnel.signed_up"), value: f.signed_up, note: pct(f.signed_up, f.signed_up) },
    { key: "email_verified", label: t("dashboard.funnel.email_verified"), value: f.email_verified, note: pct(f.email_verified, f.signed_up) },
    { key: "onboarded", label: t("dashboard.funnel.onboarded"), value: f.onboarded, note: pct(f.onboarded, f.signed_up) },
    { key: "messaged", label: t("dashboard.funnel.messaged"), value: f.messaged, note: pct(f.messaged, f.signed_up) },
    { key: "mutual", label: t("dashboard.funnel.mutual"), value: f.mutual, note: pct(f.mutual, f.signed_up) },
  ];

  const r = d.requests;
  const decided = r.accepted + r.declined;
  const requests: BarRow[] = [
    { key: "accepted", label: t("dashboard.requests.accepted"), value: r.accepted, note: pct(r.accepted, r.sent) },
    { key: "declined", label: t("dashboard.requests.declined"), value: r.declined, note: pct(r.declined, r.sent) },
    { key: "pending", label: t("dashboard.requests.pending"), value: r.pending, note: pct(r.pending, r.sent) },
  ];

  /** Sözlükten sıralı satırlar (en büyüğü üstte); bilinmeyen anahtar olduğu gibi yazılır. */
  const rowsFrom = (obj: Record<string, number>, ns: string, order?: string[]): BarRow[] => {
    const total = Object.values(obj).reduce((s, v) => s + v, 0);
    const keys = order ? order.filter((k) => k in obj) : Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    return keys.map((k) => {
      const text = t(`${ns}.${k}`);
      return { key: k, label: text === `${ns}.${k}` ? k : text, value: obj[k], note: pct(obj[k], total) };
    });
  };
  const peopleTotal = Object.values(d.audience.gender).reduce((s, v) => s + v, 0);
  const cities: BarRow[] = d.audience.cities.map((c) => ({
    key: `${c.country}-${c.city}`,
    label: c.country && c.country !== "TR" ? `${c.city} (${c.country})` : c.city,
    value: c.count,
    note: pct(c.count, peopleTotal),
  }));

  const content: BarRow[] = [
    { key: "photos", label: t("dashboard.content.photos"), value: d.content.photos },
    { key: "voice", label: t("dashboard.content.voice"), value: d.content.voice },
    { key: "anon_chats", label: t("dashboard.content.anon_chats"), value: d.content.anon_chats },
    { key: "friendships", label: t("dashboard.content.friendships"), value: d.content.friendships },
  ].sort((a, b) => b.value - a.value);
  const reasons = rowsFrom(d.report_reasons, "reasons");

  const empty = <p className="text-sm text-muted">{t("dashboard.noData")}</p>;
  const list = (rows: BarRow[], max?: number) => (rows.some((x) => x.value > 0) ? <BarList rows={rows} max={max} format={n} /> : empty);

  const chart = (key: SeriesKey, variant: "column" | "area") => (
    <DailyChart
      title={t(`dashboard.series.${key}`)}
      hint={t(`dashboard.seriesHint.${key}`)}
      points={points(key)}
      variant={variant}
      locale={locale}
      tableLabel={t("dashboard.showTable")}
      dayHeader={t("common.date")}
      valueHeader={t("dashboard.value")}
      emptyLabel={t("dashboard.noData")}
      total={d.totals[key]}
    />
  );

  return (
    <div className="max-w-6xl space-y-10">
      {/* Başlık ve dönem seçici */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">{t("overview.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("dashboard.range", { from: label(d.from), to: label(d.to) })}
          </p>
        </div>
        <nav aria-label={t("dashboard.period")}>
          <ul className="flex gap-1 rounded-full border border-edge bg-night-deep p-1">
            {PERIODS.map((p) => (
              <li key={p}>
                <Link
                  href={p === 30 ? "/" : `/?days=${p}`}
                  aria-current={p === days ? "page" : undefined}
                  className={
                    "block rounded-full px-4 py-1.5 text-sm " +
                    (p === days ? "bg-coral font-semibold text-ink" : "text-muted hover:text-moon")
                  }
                >
                  {t("dashboard.days", { n: p })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Bekleyen işler */}
      <section aria-labelledby="ov-pending">
        <h2 id="ov-pending" className="text-lg">{t("overview.pending")}</h2>
        {allClear && <p className="mt-1 text-sm text-muted">{t("overview.allClear")}</p>}
        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {queues.map((q) => {
            const { count, oldest } = d.queues[q.key];
            const wait = count > 0 ? fmtWaiting(oldest) : null;
            return (
              <li key={q.key}>
                <Link
                  href={q.href}
                  className={
                    "flex h-full flex-col rounded-[var(--radius-card)] border bg-surface p-4 hover:border-lilac " +
                    (count > 0 ? "border-coral" : "border-edge")
                  }
                >
                  <span className="flex items-center gap-2 text-sm text-muted">
                    {count > 0 && <span aria-hidden className="size-2 shrink-0 rounded-full bg-coral" />}
                    {q.label}
                  </span>
                  <span className="mt-2 text-3xl font-semibold">{n(count)}</span>
                  {wait && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-coral-text">
                      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                      {wait}
                    </span>
                  )}
                  <span className="mt-auto pt-2 text-xs text-lilac">{t("overview.open")} →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Dönem özeti: önceki eşit dönemle karşılaştırma */}
      <section aria-labelledby="ov-kpi">
        <h2 id="ov-kpi" className="text-lg">{t("dashboard.periodSummary", { days })}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map(({ key, upIsGood }) => (
            <li key={key}>
              <StatTile
                label={t(`dashboard.series.${key}`)}
                value={n(d.totals[key])}
                d={delta(d.totals[key], d.previous[key], upIsGood, t)}
                vsLabel={vs}
                trend={trend(key)}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* Günlük grafikler */}
      <section aria-labelledby="ov-daily" className="space-y-3">
        <h2 id="ov-daily" className="text-lg">{t("dashboard.daily")}</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {chart("signups", "column")}
          {chart("active", "area")}
          {chart("messages", "area")}
          {chart("conversations", "column")}
        </div>
        {chart("reports", "column")}
      </section>

      {/* Anlık durum */}
      <section aria-labelledby="ov-now">
        <h2 id="ov-now" className="text-lg">{t("dashboard.now")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <li><StatTile label={t("overview.totalUsers")} value={n(d.now.users)} /></li>
          <li><StatTile label={t("overview.active7d")} value={n(d.now.active_7d)} /></li>
          <li>
            <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-edge bg-surface p-4">
              <span className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className="size-2 rounded-full bg-online" />
                {t("dashboard.online")}
              </span>
              <span className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em]">{n(d.now.online)}</span>
              <span className="mt-2 text-xs text-muted">{t("dashboard.onlineHint")}</span>
            </div>
          </li>
          <li><StatTile label={t("dashboard.students")} value={n(d.now.students)} /></li>
          <li><StatTile label={t("dashboard.friendships")} value={n(d.now.friendships)} /></li>
        </ul>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["suspended", "closed", "age_verification_required"] as const).map((s) => (
            <li key={s}>
              <Link
                href={`/users?status=${s}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-edge bg-surface px-4 py-3 hover:border-lilac"
              >
                <span className="text-sm text-muted">{t(`accountStatus.${s}`)}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold">{n(d.now[s])}</span>
                  <span className="text-xs text-lilac">{t("overview.list")} →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{t("overview.usersHint")}</p>
      </section>

      {/* Büyüme: kayıttan sohbete, geri gelme, istekler */}
      <section aria-labelledby="ov-growth" className="space-y-3">
        <h2 id="ov-growth" className="text-lg">{t("dashboard.growth")}</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title={t("dashboard.funnelTitle")} hint={t("dashboard.funnelHint", { days })} className="lg:col-span-2">
            {f.signed_up > 0 ? <BarList rows={funnel} max={f.signed_up} format={n} /> : empty}
          </Card>
          <div className="grid gap-3">
            <Card title={t("dashboard.retentionTitle")} hint={t("dashboard.retentionHint")}>
              <p className="text-[40px] font-semibold leading-none tracking-[-0.02em]">
                {pct(d.retention.returned, d.retention.eligible)}
              </p>
              <p className="mt-2 text-xs text-muted">
                {t("dashboard.retentionDetail", { returned: n(d.retention.returned), eligible: n(d.retention.eligible) })}
              </p>
            </Card>
            <Card title={t("dashboard.requestsTitle")} hint={t("dashboard.requestsHint", { sent: n(r.sent) })}>
              <p className="text-[40px] font-semibold leading-none tracking-[-0.02em]">{pct(r.accepted, decided)}</p>
              <p className="mt-2 text-xs text-muted">{t("dashboard.acceptRate")}</p>
              <div className="mt-4">{list(requests, r.sent)}</div>
            </Card>
          </div>
        </div>
      </section>

      {/* Kitle */}
      <section aria-labelledby="ov-audience" className="space-y-3">
        <div>
          <h2 id="ov-audience" className="text-lg">{t("dashboard.audience")}</h2>
          <p className="mt-1 text-xs text-muted">{t("dashboard.audienceHint")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card title={t("dashboard.lookingFor")} hint={t("dashboard.lookingForHint")}>
            {list(rowsFrom(d.audience.looking_for, "lookingFor"))}
          </Card>
          <Card title={t("dashboard.cities")}>{list(cities)}</Card>
          <Card title={t("dashboard.ageGroups")}>{list(rowsFrom(d.audience.age, "dashboard.ageBucket", AGE_BUCKETS))}</Card>
          <Card title={t("dashboard.gender")}>{list(rowsFrom(d.audience.gender, "gender"))}</Card>
        </div>
      </section>

      {/* İçerik ve güvenlik */}
      <section aria-labelledby="ov-content" className="space-y-3">
        <h2 id="ov-content" className="text-lg">{t("dashboard.contentSafety")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Card title={t("dashboard.contentTitle")} hint={t("dashboard.inPeriod", { days })}>{list(content)}</Card>
          <Card title={t("dashboard.reasonsTitle")} hint={t("dashboard.inPeriod", { days })}>{list(reasons)}</Card>
        </div>
      </section>
    </div>
  );
}
