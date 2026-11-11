-- =============================================================================
-- Sohby — Yönetim paneli: Genel bakış
-- =============================================================================
-- * Panelin açılış ekranı: bekleyen işler, kullanıcı sayıları, hesap
--   durumları ve son etkinlik. Yalnızca toplam sayılar döner; kişi, mesaj
--   içeriği ya da flört tercihi gibi bilgi YOKTUR.
-- * Ekranın açılması işlem kaydına yazılır (overview.view), panelin diğer
--   sayfaları gibi.
-- * "Bugün" Türkiye saatine göre gece yarısından başlar.
-- * Test hesapları (is_test) ve silinmiş hesaplar kullanıcı sayılarına girmez.
-- =============================================================================

create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  perform private.admin_audit('overview.view');
  return jsonb_build_object(
    'pending', private.admin_pending_counts(),
    'users', (
      select jsonb_build_object(
        'total', count(*),
        'new_today', count(*) filter (where p.created_at >= v_today),
        'new_7d', count(*) filter (where p.created_at >= now() - interval '7 days'),
        'new_prev_7d', count(*) filter (where p.created_at >= now() - interval '14 days'
                                          and p.created_at < now() - interval '7 days'),
        'active_7d', count(*) filter (where p.last_seen_at >= now() - interval '7 days'),
        'suspended', count(*) filter (where p.account_status = 'suspended'),
        'closed', count(*) filter (where p.account_status = 'closed'),
        'age_verification_required', count(*) filter (where p.account_status = 'age_verification_required')
      )
      from public.profiles p
      where p.deleted_at is null and not p.is_test
    ),
    'activity', jsonb_build_object(
      'messages_24h',
        (select count(*) from public.messages where created_at >= now() - interval '24 hours')
        + (select count(*) from public.anon_messages where created_at >= now() - interval '24 hours'),
      'conversations_24h',
        (select count(*) from public.conversations where created_at >= now() - interval '24 hours')
        + (select count(*) from public.anon_conversations where created_at >= now() - interval '24 hours'),
      'reports_7d', (select count(*) from public.reports where created_at >= now() - interval '7 days')
    )
  );
end;
$$;

revoke execute on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;
