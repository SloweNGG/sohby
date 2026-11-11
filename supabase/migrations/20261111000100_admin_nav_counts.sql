-- =============================================================================
-- Sohby — Yönetim paneli: menüdeki bekleyen iş sayıları
-- =============================================================================
-- * Panelin her sayfasında menüde gösterilir: açık şikâyet, onay bekleyen
--   fotoğraf, bekleyen yaş belgesi, açık itiraz.
-- * Yalnızca dört sayı döner; kişi, içerik ya da kimlik bilgisi YOKTUR.
--   Bu yüzden her sayfa açılışında işlem kaydına ayrı satır yazmaz (sayfanın
--   kendisi zaten kaydedilir). Yetki yine veritabanında denetlenir.
-- =============================================================================

-- Yönetici değilse reddeder; kayda yazmaz (yalnızca toplam sayı döndüren
-- fonksiyonlar içindir — kişisel veri döndüren her fonksiyon admin_audit kullanır).
create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_nav_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'reports', (select count(*) from public.reports where status in ('open', 'reviewing')),
    'photos', (select count(*) from public.profile_photos where status = 'pending'),
    'age_documents', (select count(*) from private.age_documents where status = 'pending'),
    'appeals', (select count(*) from public.appeals where status = 'open')
  );
end;
$$;

revoke execute on function private.require_admin() from public, anon, authenticated;
revoke execute on function public.admin_nav_counts() from public, anon, authenticated;
grant execute on function public.admin_nav_counts() to authenticated;
