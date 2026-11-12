/**
 * Ana menü. CLAUDE.md'deki tam menü: Keşfet, Harita, Sohbetler, Bildirimler,
 * Ayarlar, Profil. Yalnızca ÇALIŞAN sayfalar gösterilir (Harita 2. aşamada
 * eklenecek). `route`, Next.js sayfa dosyasının yolu — testte
 * her öğenin gerçekten var olan bir sayfaya gittiği denetlenir.
 */
export const NAV_ITEMS = [
  { key: "discover", route: "/discover" },
  { key: "campus", route: "/campus" },
  { key: "chats", route: "/chats" },
  { key: "notifications", route: "/notifications" },
  { key: "settings", route: "/settings" },
  { key: "profile", route: "/u/[username]" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

/** Hesap menüsündeki ek bağlantılar (profil). */
export const ACCOUNT_LINKS = [
  { key: "editProfile", route: "/profile/edit" },
  { key: "myFriends", route: "/u/[username]/friends" },
] as const;

export function navHref(key: NavKey, username: string) {
  return key === "profile" ? `/u/${username}` : NAV_ITEMS.find((i) => i.key === key)!.route;
}

/** Hangi menü öğesi seçili? Başkasının profili Keşfet'e sayılır. */
export function activeSection(pathname: string, username: string): NavKey | null {
  if (pathname.startsWith("/chats")) return "chats";
  if (pathname.startsWith("/campus")) return "campus";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname === `/u/${username}` || pathname.startsWith(`/u/${username}/`) || pathname.startsWith("/profile")) {
    return "profile";
  }
  if (pathname.startsWith("/discover") || pathname.startsWith("/u/")) return "discover";
  return null;
}
