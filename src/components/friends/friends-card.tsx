import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { FriendList } from "@/lib/types";
import { FriendAvatar } from "./friend-avatar";

/**
 * Profildeki "Arkadaşları" kartı (tasarim/07): ilk birkaç arkadaş, "Tümünü gör (N)"
 * ve ortak arkadaşlar. Başkasının listesi yalnızca sahibi açtıysa gelir.
 */
export async function FriendsCard({
  list,
  username,
  locale,
  listPublic,
}: {
  list: FriendList;
  username: string;
  locale: Locale;
  /** Kendi profilim: listem başkalarına açık mı? */
  listPublic?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "friends" });
  if (!list.visible) return null;
  if (!list.is_self && list.total === 0) return null;

  const mutual = list.items.filter((i) => i.is_mutual);
  const listFormat = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });

  return (
    <section className="md:rounded-[var(--radius-card)] md:bg-surface md:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3 md:mb-4">
        <h2 className="text-lg md:text-xl">{list.is_self ? t("myFriendsTitle") : t("theirFriendsTitle")}</h2>
        {list.total > 0 && (
          <Link href={`/u/${username}/friends`} className="shrink-0 text-sm font-semibold text-lilac hover:underline">
            {t("seeAll", { count: list.total })}
          </Link>
        )}
      </div>
      {list.total === 0 ? (
        <p className="text-muted">{t("emptySelf")}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-x-2 gap-y-4">
          {list.items.map((f) => (
            <li key={f.id}>
              <Link href={`/u/${f.username}`} className="flex flex-col items-center gap-1.5 text-center hover:text-lilac">
                <FriendAvatar
                  user={f}
                  locale={locale}
                  className={f.is_mutual ? "rounded-full ring-2 ring-coral ring-offset-2 ring-offset-surface" : undefined}
                />
                <span className="w-full truncate text-[13px]">{f.is_me ? t("you") : f.display_name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!list.is_self && list.mutual_count > 0 && (
        <p className="mt-4 text-sm text-muted">
          <span className="font-semibold text-coral-text">{t("mutualCount", { count: list.mutual_count })}</span>{" "}
          {listFormat.format(mutual.slice(0, 3).map((m) => m.display_name))}
        </p>
      )}
      {list.is_self && listPublic === false && list.total > 0 && (
        <p className="mt-4 text-[13px] text-muted">
          {t("privateListHint")}{" "}
          <Link href="/settings#privacy" className="font-semibold text-lilac hover:underline">
            {t("privateListLink")}
          </Link>
        </p>
      )}
    </section>
  );
}
