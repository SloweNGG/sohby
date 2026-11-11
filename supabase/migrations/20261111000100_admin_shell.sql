-- =============================================================================
-- Sohby — Yönetim paneli: menü bilgisi (yönetici mi + bekleyen iş sayıları)
-- =============================================================================
-- * Panelin her sayfası açılırken TEK veritabanı çağrısıyla hem "bu kişi
--   yönetici mi?" sorusunun cevabını hem de menüdeki bekleyen iş sayılarını
--   (açık şikâyet, onay bekleyen fotoğraf, bekleyen yaş belgesi, açık itiraz)
--   alır. Ayrı ayrı sormak her sayfaya bir gidiş-dönüş daha ekliyordu.
-- * Yönetici değilse sayılar DÖNMEZ (yalnızca is_admin = false).
-- * Yalnızca dört toplam sayı döner; kişi, içerik ya da kimlik bilgisi YOKTUR.
--   Bu yüzden her sayfa açılışında işlem kaydına ayrı satır yazmaz (sayfanın
--   kendisi zaten kaydedilir).
-- =============================================================================

-- Yetki denetimi YAPMAZ: yalnızca yönetici denetimi yapan fonksiyonların
-- içinden çağrılır; hiçbir rol doğrudan çalıştıramaz.
create or replace function private.admin_pending_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.reports where status in ('open', 'reviewing')),
    'photos', (select count(*) from public.profile_photos where status = 'pending'),
    'age_documents', (select count(*) from private.age_documents where status = 'pending'),
    'appeals', (select count(*) from public.appeals where status = 'open')
  )
$$;

create or replace function public.admin_shell()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    return jsonb_build_object('is_admin', false);
  end if;
  return jsonb_build_object('is_admin', true, 'counts', private.admin_pending_counts());
end;
$$;

revoke execute on function private.admin_pending_counts() from public, anon, authenticated;
revoke execute on function public.admin_shell() from public, anon, authenticated;
grant execute on function public.admin_shell() to authenticated;
