-- =============================================================================
-- Sohby — 6: Profil fotoğrafı (gizli bucket, imzalı bağlantılar, onay)
-- =============================================================================
-- * Fotoğraflar gizli `profile-photos` bucket'ında tutulur. Kullanıcıların
--   bucket'a doğrudan YAZMA izni yoktur: yükleme yalnızca `upload-profile-photo`
--   Edge Function'ı üzerinden yapılır (dosya türü bayt düzeyinde doğrulanır,
--   EXIF/GPS dahil tüm üst veriler silinir — CLAUDE.md kural 12).
-- * Fotoğrafı yalnızca o profili görmeye yetkili kişiler, sunucunun ürettiği
--   kısa ömürlü imzalı bağlantıyla görebilir (storage RLS + profile_visible_to).
-- * Otomatik onay ayarı (varsayılan AÇIK) yönetim panelinden değiştirilir;
--   kapalıyken fotoğraf "inceleniyor" olarak bekler ve kimseye gösterilmez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Uygulama ayarları (yalnızca yönetim fonksiyonları değiştirir)
-- -----------------------------------------------------------------------------
create table private.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table private.app_settings enable row level security;
revoke all on private.app_settings from public, anon, authenticated;

insert into private.app_settings (key, value) values ('photo_auto_approve', 'true'::jsonb);

create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::boolean from private.app_settings where key = p_key), p_default)
$$;

-- -----------------------------------------------------------------------------
-- profile_photos
-- -----------------------------------------------------------------------------
create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  constraint profile_photos_path_owner check (split_part(storage_path, '/', 1) = user_id::text)
);

create index profile_photos_user_idx on public.profile_photos (user_id, created_at desc);
create index profile_photos_pending_idx on public.profile_photos (created_at) where status = 'pending';

-- Yükleme sayacı (hız sınırı için; fotoğraf kayıtları değiştirilince silindiğinden ayrı tutulur).
create table private.photo_uploads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index photo_uploads_user_idx on private.photo_uploads (user_id, created_at desc);
alter table private.photo_uploads enable row level security;
revoke all on private.photo_uploads from public, anon, authenticated;

alter table public.profiles
  add column photo_id uuid references public.profile_photos (id) on delete set null;

alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from public, anon, authenticated;

-- Kullanıcı yalnızca kendi fotoğraflarının durumunu görür. Yazma yok.
grant select on public.profile_photos to authenticated;
create policy "profile_photos: sahibi okur"
  on public.profile_photos for select to authenticated
  using (user_id = (select auth.uid()));

-- Profilde gösterilecek (onaylı ve seçili) fotoğrafın yolu.
create or replace function private.current_photo_path(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ph.storage_path
  from public.profiles p
  join public.profile_photos ph on ph.id = p.photo_id
  where p.id = p_user and ph.status = 'approved'
$$;

-- Storage RLS için: bu nesneyi izleyen kişi görebilir mi?
create or replace function private.can_view_profile_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_photos ph
    where ph.storage_path = p_name
      and (
        ph.user_id = auth.uid()
        or (
          ph.status = 'approved'
          and exists (select 1 from public.profiles p where p.id = ph.user_id and p.photo_id = ph.id)
          and private.profile_visible_to(ph.user_id, auth.uid())
        )
      )
  )
$$;

-- Profil kartına fotoğraf yolu eklenir (yalnızca onaylı ve seçili fotoğraf).
create or replace function private.profile_card(p_target uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', coalesce(p.display_name, p.username),
    'age', case when p.show_age or p.id = p_viewer then private.age_years(pp.birth_date) end,
    'gender', case when (p.show_gender or p.id = p_viewer) and p.gender <> 'unspecified' then p.gender end,
    'city', p.city,
    'district', case when p.show_district or p.id = p_viewer then p.district end,
    'occupation', p.occupation,
    'bio', p.bio,
    'languages', to_jsonb(p.languages),
    'looking_for', to_jsonb(
      case
        when p.id = p_viewer or private.flirt_compatible(p.id, p_viewer) then p.looking_for
        else array_remove(p.looking_for, 'flirt')
      end
    ),
    'is_online', private.is_online(p.show_online, p.last_seen_at),
    'member_since', date_trunc('month', p.created_at),
    'photo_path', private.current_photo_path(p.id),
    'common_hobby_count', case when p.id = p_viewer then 0 else private.common_hobby_count(p.id, p_viewer) end,
    'hobbies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', h.slug,
          'name_tr', h.name_tr,
          'name_en', h.name_en,
          'common', p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v where v.profile_id = p_viewer and v.hobby_id = h.id
          )
        )
        order by
          (p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v where v.profile_id = p_viewer and v.hobby_id = h.id
          )) desc,
          h.name_tr
      )
      from public.profile_hobbies ph
      join public.hobbies h on h.id = ph.hobby_id
      where ph.profile_id = p.id
    ), '[]'::jsonb)
  )
  from public.profiles p
  join public.profile_private pp on pp.id = p.id
  where p.id = p_target
$$;

-- -----------------------------------------------------------------------------
-- Edge Function'ın (service_role) kullandığı fonksiyonlar
-- -----------------------------------------------------------------------------
-- Yeni fotoğrafı kaydeder. Otomatik onay açıksa hemen profil fotoğrafı olur.
-- Silinmesi gereken eski dosya yollarını döndürür (fonksiyon bucket'tan siler).
create or replace function public.register_profile_photo(p_user uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_id uuid;
  v_old text[];
begin
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (
    select count(*) from private.photo_uploads
    where user_id = p_user and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.photo_uploads (user_id) values (p_user);

  v_status := case when private.setting_bool('photo_auto_approve', true) then 'approved' else 'pending' end;

  -- Bekleyen eski yüklemeler ve (yeni fotoğraf onaylıysa) eski profil fotoğrafı kaldırılır.
  select coalesce(array_agg(storage_path), '{}') into v_old
  from public.profile_photos
  where user_id = p_user
    and (status in ('pending', 'rejected')
         or (v_status = 'approved' and status = 'approved'));

  delete from public.profile_photos where user_id = p_user and storage_path = any (v_old);

  insert into public.profile_photos (user_id, storage_path, status, reviewed_at)
  values (p_user, p_path, v_status, case when v_status = 'approved' then now() end)
  returning id into v_id;

  if v_status = 'approved' then
    update public.profiles set photo_id = v_id where id = p_user;
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status, 'remove_paths', to_jsonb(v_old));
end;
$$;

-- Kullanıcının fotoğrafını kaldırır; silinecek dosya yollarını döndürür.
create or replace function public.remove_profile_photos(p_user uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.profile_photos where user_id = p_user;
  update public.profiles set photo_id = null where id = p_user;
  delete from public.profile_photos where user_id = p_user;
  return v_paths;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage: gizli bucket ve erişim kuralları
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yalnızca OKUMA (imzalı bağlantı üretmek için gerekli). Ekleme/güncelleme/
-- silme politikası bilinçli olarak yok: yalnızca Edge Function (service_role) yazar.
create policy "profile-photos: yetkili kişiler okur"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and private.can_view_profile_photo(name));

-- -----------------------------------------------------------------------------
-- Yetkiler (yalnızca bu dosyadaki yeni fonksiyonlar)
-- -----------------------------------------------------------------------------
revoke execute on function private.setting_bool(text, boolean) from public, anon, authenticated;
revoke execute on function private.current_photo_path(uuid) from public, anon, authenticated;
revoke execute on function private.can_view_profile_photo(text) from public, anon, authenticated;
revoke execute on function private.profile_card(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.register_profile_photo(uuid, text) from public, anon, authenticated;
revoke execute on function public.remove_profile_photos(uuid) from public, anon, authenticated;

grant execute on function private.can_view_profile_photo(text) to authenticated;
grant execute on function public.register_profile_photo(uuid, text) to service_role;
grant execute on function public.remove_profile_photos(uuid) to service_role;
