import { Suspense } from "react";
import Link from "next/link";
import { getT } from "@/lib/i18n";
import { adminRpc, createClient } from "@/lib/supabase";
import { setUserStatusAction } from "@/lib/actions";
import { ageFrom, fmtDate, fmtDateTime } from "@/lib/format";
import { AdminShell, Badge, btn, input } from "@/components/shell";

type Brief = { id: string; username: string; deleted_at: string | null } | null;
type ReportRow = { id: string; reason: string; status: string; created_at: string; is_anonymous: boolean; other: Brief };
type Detail = {
  profile: {
    id: string; username: string; display_name: string | null; email: string | null; email_confirmed_at: string | null;
    birth_date: string | null; gender: string; country_code: string; city: string | null; district: string | null; occupation: string | null; bio: string | null;
    looking_for: string[]; languages: string[]; hobbies: Array<{ tr: string; en: string }>;
    account_status: string; status_reason: string | null; suspended_until: string | null; status_changed_at: string | null;
    created_at: string; last_seen_at: string | null; onboarding_completed_at: string | null; deleted_at: string | null; is_test: boolean;
  };
  stats: { conversations: number; messages_sent: number; blocked_by: number; blocks_made: number };
  photos: Array<{ id: string; storage_path: string; status: string; created_at: string; is_current: boolean }>;
  reports_against: ReportRow[];
  reports_filed: ReportRow[];
  appeals: Array<{ id: string; status: string; account_status: string; message: string; created_at: string; reviewed_at: string | null }>;
  age_documents: Array<{ id: string; status: string; created_at: string; reviewed_at: string | null; review_note: string | null }>;
  admin_history: Array<{ id: number; action: string; target_type: string | null; details: Record<string, unknown>; created_at: string; admin_username: string | null }>;
};
const STATUSES = ["active", "age_verification_required", "suspended", "closed"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // admin_get_user her açılışı işlem kaydına yazar (kural 14). Flört tercihi ve mesaj içeriği içermez.
  // Yönetici kontrolüyle aynı anda başlar.
  const detail = UUID.test(id) ? adminRpc<Detail>("admin_get_user", { p_user: id }) : null;
  return (
    <AdminShell>
      <UserDetail detail={detail} />
    </AdminShell>
  );
}

async function UserDetail({ detail }: { detail: ReturnType<typeof adminRpc<Detail>> | null }) {
  const { t, locale } = getT();
  const d = detail ? (await detail).data : null;
  if (!d) return <NotFound />;
  const p = d.profile;
  const age = ageFrom(p.birth_date);

  // Ülke adı yalnızca sunucuda üretilir (Unicode CLDR); Türkiye için yazılmaz.
  const country = p.country_code && p.country_code !== "TR" ? new Intl.DisplayNames([locale], { type: "region" }).of(p.country_code) : null;
  const place = [p.district, p.city, country].filter(Boolean).join(", ");
  const historyText = (h: Detail["admin_history"][number]) => {
    // Çeviri anahtarlarında nokta alt başlık demek; işlem adındaki noktalar alt çizgiye çevrilir.
    const key = `history.${h.action.replace(/\./g, "_")}`;
    const label = t(key);
    const known = label !== key;
    if (h.action === "user.status") {
      const s = String(h.details.status ?? "");
      const reason = String(h.details.reason ?? "");
      return `${label}: ${t(`accountStatus.${s}`)}${reason ? ` · ${reason}` : ""}`;
    }
    return known ? label : h.action;
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link href="/users" className="text-sm text-muted hover:text-moon">← {t("common.back")}</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl">@{p.username}</h1>
          {p.display_name && <span className="text-muted">{p.display_name}</span>}
          <Badge>{t(`accountStatus.${p.account_status}`)}</Badge>
          {p.deleted_at && <Badge>{t("common.deleted")}</Badge>}
          {p.is_test && <Badge>{t("userDetail.testAccount")}</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted">{t("userDetail.viewLogged")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t("userDetail.account")}>
          <Rows
            rows={[
              [t("users.email"), `${p.email ?? "—"} · ${p.email_confirmed_at ? t("userDetail.verified") : t("userDetail.notVerified")}`],
              [t("userDetail.birthDate"), p.birth_date ? `${fmtDate(p.birth_date)}${age !== null ? ` · ${t("ageDocs.age", { age })}` : ""}` : "—"],
              [t("userDetail.joined"), fmtDateTime(p.created_at)],
              [t("userDetail.lastSeen"), fmtDateTime(p.last_seen_at)],
              [t("userDetail.onboarding"), p.onboarding_completed_at ? t("userDetail.done") : t("userDetail.notDone")],
              [t("common.status"), t(`accountStatus.${p.account_status}`)],
              ...(p.status_reason ? ([[t("userDetail.statusReason"), p.status_reason]] as [string, string][]) : []),
              ...(p.suspended_until ? ([[t("userDetail.suspendedUntil"), fmtDateTime(p.suspended_until)]] as [string, string][]) : []),
              ...(p.deleted_at ? ([[t("userDetail.deletedAt"), fmtDateTime(p.deleted_at)]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card title={t("userDetail.profile")}>
          <Rows
            rows={[
              [t("userDetail.gender"), t(`gender.${p.gender}`)],
              [t("userDetail.place"), place || "—"],
              [t("userDetail.occupation"), p.occupation ?? "—"],
              [t("userDetail.lookingFor"), p.looking_for.length ? p.looking_for.map((x) => t(`lookingFor.${x}`)).join(", ") : "—"],
              [t("userDetail.languages"), p.languages.length ? p.languages.map((x) => x.toUpperCase()).join(", ") : "—"],
              [t("userDetail.hobbies"), p.hobbies.length ? p.hobbies.map((h) => (locale === "en" ? h.en : h.tr)).join(", ") : "—"],
            ]}
          />
          {p.bio && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm">{p.bio}</p>}
        </Card>
      </div>

      <Card title={t("userDetail.changeStatus")}>
        <form action={setUserStatusAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="user" value={p.id} />
          <input type="hidden" name="back" value={`/users/${p.id}`} />
          <select name="status" defaultValue={p.account_status} aria-label={t("users.setStatus")} className={input}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`accountStatus.${s}`)}</option>)}
          </select>
          <input name="reason" defaultValue={p.status_reason ?? ""} placeholder={t("users.reason")} aria-label={t("users.reason")} maxLength={500} className={`${input} min-w-0 flex-1`} />
          <input name="until" type="datetime-local" aria-label={t("users.until")} className={input} />
          <button className={btn}>{t("users.setStatus")}</button>
        </form>
        <p className="mt-2 text-xs text-muted">{t("userDetail.statusHint")}</p>
      </Card>

      <section aria-labelledby="ud-stats">
        <h2 id="ud-stats" className="text-lg">{t("userDetail.activity")}</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [t("userDetail.conversations"), d.stats.conversations],
            [t("userDetail.messagesSent"), d.stats.messages_sent],
            [t("userDetail.blockedBy"), d.stats.blocked_by],
            [t("userDetail.blocksMade"), d.stats.blocks_made],
          ].map(([label, value]) => (
            <li key={String(label)} className="rounded-[20px] border border-edge bg-surface p-4">
              <span className="block text-sm text-muted">{label}</span>
              <span className="mt-2 block text-2xl font-semibold">{value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{t("userDetail.activityHint")}</p>
      </section>

      <section aria-labelledby="ud-photos">
        <h2 id="ud-photos" className="text-lg">{t("userDetail.photos")}</h2>
        {d.photos.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
        ) : (
          // Fotoğraf bağlantıları ayrıca alınır; sayfanın geri kalanı onları beklemez.
          <Suspense fallback={<PhotoGrid photos={d.photos} username={p.username} urlOf={new Map()} />}>
            <SignedPhotoGrid photos={d.photos} username={p.username} />
          </Suspense>
        )}
      </section>

      <ReportList title={t("userDetail.reportsAgainst")} otherLabel={t("reports.reporter")} rows={d.reports_against} />
      <ReportList title={t("userDetail.reportsFiled")} otherLabel={t("reports.reported")} rows={d.reports_filed} />

      <section aria-labelledby="ud-appeals">
        <h2 id="ud-appeals" className="text-lg">{t("nav.appeals")}</h2>
        {d.appeals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {d.appeals.map((a) => (
              <li key={a.id} className="rounded-[20px] border border-edge bg-surface p-4 text-sm">
                <p className="text-muted">
                  {fmtDateTime(a.created_at)} · {t(`userDetail.appealStatus.${a.status}`)} · {t("appeals.statusAtAppeal")}: {t(`accountStatus.${a.account_status}`)}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{a.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ud-age">
        <h2 id="ud-age" className="text-lg">{t("nav.ageDocuments")}</h2>
        {d.age_documents.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.age_documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-muted">{fmtDateTime(doc.created_at)}</span>
                <Badge>{t(`ageDocs.status.${doc.status}`)}</Badge>
                {doc.review_note && <span className="text-muted">{doc.review_note}</span>}
                {doc.status === "pending" && (
                  <Link href="/age-documents" className="text-lilac underline-offset-4 hover:underline">{t("userDetail.review")}</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ud-history">
        <h2 id="ud-history" className="text-lg">{t("userDetail.history")}</h2>
        {d.admin_history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.admin_history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3 py-2">
                <span className="whitespace-nowrap text-muted">{fmtDateTime(h.created_at)}</span>
                <span>{historyText(h)}</span>
                {h.admin_username && <span className="text-muted">@{h.admin_username}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Photo = Detail["photos"][number];

// Profil fotoğrafları gizli bucket'ta: yönetici oturumuyla 5 dakikalık imzalı bağlantı.
async function SignedPhotoGrid({ photos, username }: { photos: Photo[]; username: string }) {
  const supabase = await createClient();
  const { data: signed } = await supabase.storage.from("profile-photos").createSignedUrls(photos.map((x) => x.storage_path), 300);
  const urlOf = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) urlOf.set(s.path, s.signedUrl);
  return <PhotoGrid photos={photos} username={username} urlOf={urlOf} />;
}

function PhotoGrid({ photos, username, urlOf }: { photos: Photo[]; username: string; urlOf: Map<string, string> }) {
  const { t } = getT();
  return (
    <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {photos.map((ph) => (
        <li key={ph.id} className="overflow-hidden rounded-[20px] border border-edge bg-surface">
          {urlOf.get(ph.storage_path) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urlOf.get(ph.storage_path)!} alt={`@${username}`} className="aspect-square w-full object-cover" />
          ) : (
            <div className="aspect-square w-full bg-night-deep" />
          )}
          <div className="flex flex-wrap gap-1 p-2 text-xs">
            <Badge>{t(`userDetail.photoStatus.${ph.status}`)}</Badge>
            {ph.is_current && <Badge>{t("userDetail.currentPhoto")}</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotFound() {
  const { t } = getT();
  return (
    <section>
      <Link href="/users" className="text-sm text-muted hover:text-moon">← {t("common.back")}</Link>
      <p className="mt-4 text-muted">{t("userDetail.notFound")}</p>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-edge bg-surface p-4">
      <h2 className="mb-3 text-lg">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportList({ title, otherLabel, rows }: { title: string; otherLabel: string; rows: ReportRow[] }) {
  const { t } = getT();
  return (
    <section>
      <h2 className="text-lg">{title} <span className="text-sm font-normal text-muted">({rows.length})</span></h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4">{t("common.date")}</th>
                <th className="py-2 pr-4">{t("reports.reason")}</th>
                <th className="py-2 pr-4">{otherLabel}</th>
                <th className="py-2 pr-4">{t("common.status")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2 pr-4">{fmtDateTime(r.created_at)}</td>
                  <td className="py-2 pr-4">
                    {t(`reasons.${r.reason}`)} {r.is_anonymous && <Badge>{t("reports.anonymous")}</Badge>}
                  </td>
                  <td className="py-2 pr-4">
                    {r.other ? (
                      <Link href={`/users/${r.other.id}`} className="text-lilac underline-offset-4 hover:underline">@{r.other.username}</Link>
                    ) : "—"}
                  </td>
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
