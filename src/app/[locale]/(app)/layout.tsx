import { resolveLocale } from "@/i18n/locale";
import { redirect } from "@/i18n/navigation";
import { getMyAccount } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { BlockedNotice } from "@/components/blocked-notice";
import { AccountStatusScreen } from "@/components/account/status-screen";
import { blockingStatus } from "@/lib/account/status";
import { BadgeProvider } from "@/components/app/badges";
import { PresenceHeartbeat } from "@/components/app/presence";
import { BottomNav, Sidebar } from "@/components/app/nav";
import type { BadgeCounts } from "@/lib/types";

// Oturuma bağlı: her istekte sunucuda render edilir.
export const dynamic = "force-dynamic";

/**
 * Giriş yapmış ve başlangıcı tamamlamış kullanıcıların sayfaları.
 * Middleware'e ek olarak burada da kontrol edilir (savunma derinliği).
 */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const account = await getMyAccount();
  if (!account) {
    redirect({ href: "/login", locale });
    return null;
  }
  if (account.private.age_check_failed_at) return <BlockedNotice withSignOut />;
  // Hesap durumu (yaş doğrulaması / askı / kapatma / silinmiş): uygulamanın geri kalanı kapalı.
  const blocking = blockingStatus(account.profile);
  if (blocking) {
    return (
      <AccountStatusScreen
        status={blocking}
        reason={account.profile.status_reason}
        suspendedUntil={account.profile.suspended_until}
      />
    );
  }
  if (!account.profile.onboarding_completed_at) {
    redirect({ href: "/onboarding", locale });
  }

  const supabase = await createClient();
  const { data: badges } = await supabase.rpc("get_badge_counts");
  const me = {
    id: account.profile.id,
    username: account.profile.username,
    displayName: account.profile.display_name ?? account.profile.username,
  };

  return (
    <BadgeProvider initial={(badges as BadgeCounts) ?? { unread_messages: 0, pending_requests: 0 }} userId={me.id}>
      <PresenceHeartbeat />
      <Sidebar me={me} />
      <div className="min-h-dvh md:pl-[76px]">{children}</div>
      <BottomNav me={me} />
    </BadgeProvider>
  );
}
