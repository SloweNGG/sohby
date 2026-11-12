import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Lock } from "lucide-react";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { withPhotoUrls } from "@/lib/photos";
import type { FriendCard, FriendList, FriendRequests } from "@/lib/types";
import { FriendAvatar } from "@/components/friends/friend-avatar";
import { FriendRequestButtons } from "@/components/friends/request-buttons";

export async function generateMetadata({ params }: PageProps<"/[locale]/u/[username]/friends">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "friends" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** Bir kişinin arkadaşları; kendi listemde gelen ve gönderilen istekler de. */
export default async function FriendsPage({ params }: PageProps<"/[locale]/u/[username]/friends">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "friends" });
  const { username } = await params;
  const supabase = await createClient();

  const [{ data: listData }, { data: profileData }] = await Promise.all([
    supabase.rpc("get_friends", { p_username: username.slice(0, 40) }),
    supabase.rpc("get_profile", { p_username: username.slice(0, 40) }),
  ]);
  const list = listData as FriendList | null;
  const owner = profileData as { display_name: string; username: string; blocked_by_me?: boolean } | null;

  const back = (
    <Link
      href={owner ? `/u/${owner.username}` : "/discover"}
      className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-moon"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {owner ? t("backToProfile", { name: owner.display_name }) : t("backToDiscover")}
    </Link>
  );

  if (!list || !owner || owner.blocked_by_me) {
    return (
      <main className="px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pt-10">
        {back}
        <h1 className="mt-8 text-3xl">{t("notFoundTitle")}</h1>
      </main>
    );
  }

  const items = await withPhotoUrls(list.items);
  let requests: FriendRequests | null = null;
  if (list.is_self) {
    const { data } = await supabase.rpc("get_friend_requests");
    const r = (data as FriendRequests | null) ?? { incoming: [], outgoing: [] };
    const signed = await withPhotoUrls([...r.incoming.map((x) => x.user), ...r.outgoing.map((x) => x.user)]);
    const byId = new Map(signed.map((u) => [u.id, u]));
    requests = {
      incoming: r.incoming.map((x) => ({ ...x, user: byId.get(x.user.id) ?? x.user })),
      outgoing: r.outgoing.map((x) => ({ ...x, user: byId.get(x.user.id) ?? x.user })),
    };
  }

  return (
    <main className="mx-auto max-w-[760px] px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-12 md:pt-10">
      {back}
      <p className="mt-6 text-sm text-muted">{list.is_self ? t("yourList") : owner.display_name}</p>
      <h1 className="text-[34px] tracking-[-0.05em]">{t("listTitle")}</h1>

      {requests && requests.incoming.length > 0 && (
        <section className="mt-8" aria-labelledby="incoming-title">
          <h2 id="incoming-title" className="text-lg">
            {t("incomingTitle", { count: requests.incoming.length })}
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] bg-surface">
            {requests.incoming.map((r) => (
              <PersonRow key={r.id} user={r.user} locale={locale}>
                <FriendRequestButtons kind="incoming" requestId={r.id} name={r.user.display_name} />
              </PersonRow>
            ))}
          </ul>
        </section>
      )}

      {!list.visible ? (
        <p className="mt-8 flex items-start gap-2 text-muted">
          <Lock className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("hiddenList", { name: owner.display_name })}
        </p>
      ) : (
        <section className="mt-8" aria-labelledby="friends-title">
          <h2 id="friends-title" className="text-lg">
            {t("countTitle", { count: list.total })}
            {!list.is_self && list.mutual_count > 0 && (
              <span className="ml-2 text-sm font-semibold text-coral-text">{t("mutualCount", { count: list.mutual_count })}</span>
            )}
          </h2>
          {items.length === 0 ? (
            <p className="mt-3 text-muted">{list.is_self ? t("emptySelf") : t("emptyOther")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] bg-surface">
              {items.map((f) => (
                <PersonRow key={f.id} user={f} locale={locale} mutual={f.is_mutual} isMe={f.is_me} />
              ))}
            </ul>
          )}
        </section>
      )}

      {requests && requests.outgoing.length > 0 && (
        <section className="mt-8" aria-labelledby="outgoing-title">
          <h2 id="outgoing-title" className="text-lg">
            {t("outgoingTitle", { count: requests.outgoing.length })}
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] bg-surface">
            {requests.outgoing.map((r) => (
              <PersonRow key={r.user.id} user={r.user} locale={locale}>
                <FriendRequestButtons kind="outgoing" targetId={r.user.id} name={r.user.display_name} />
              </PersonRow>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

async function PersonRow({
  user,
  locale,
  mutual = false,
  isMe = false,
  children,
}: {
  user: FriendCard;
  locale: Locale;
  mutual?: boolean;
  isMe?: boolean;
  children?: React.ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "friends" });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
      <Link href={`/u/${user.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-lilac">
        <FriendAvatar user={user} size={46} locale={locale} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{isMe ? t("you") : user.display_name}</span>
          <span className="block truncate text-[13px] text-muted">
            @{user.username}
            {mutual && <span className="ml-2 font-semibold text-coral-text">{t("mutual")}</span>}
          </span>
        </span>
      </Link>
      {children}
    </li>
  );
}
