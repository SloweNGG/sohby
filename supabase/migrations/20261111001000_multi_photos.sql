-- =============================================================================
-- Birden fazla profil fotoğrafı ve sıralama
-- =============================================================================
-- * Kullanıcı en çok 6 fotoğraf ekler (bekleyen + onaylı); sırasını kendisi belirler.
-- * Sıradaki ilk ONAYLI fotoğraf ana fotoğraftır (profiles.photo_id): Keşfet
--   kartları, sohbet listesi vb. onu gösterir. Sıra ya da onay değişince
--   private.sync_main_photo ile güncellenir.
-- * Onaylı her fotoğraf, profili görmeye yetkili kişilere görünür (galeri).
-- * Yükleme ve silme yine yalnızca upload-profile-photo Edge Function'ı ile
--   (üst veri silme + depo yazma); sıralama depoya dokunmadığı için doğrudan RPC.
-- =============================================================================

alter table public.profile_photos add column position integer not null default 0;

-- Mevcut fotoğraflar: yüklenme sırasıyla.
update public.profile_photos ph set position = x.rn
from (select id, (row_number() over (partition by user_id order by created_at) - 1)::int as rn from public.profile_photos) x
where x.id = ph.id;

create index profile_photos_order_idx on public.profile_photos (user_id, position);

-- Ana fotoğraf = sıradaki ilk onaylı fotoğraf.
create or replace function private.sync_main_photo(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_main uuid;
begin
  select id into v_main from public.profile_photos
  where user_id = p_user and status = 'approved'
  order by position, created_at
  limit 1;
  update public.profiles set photo_id = v_main where id = p_user and photo_id is distinct from v_main;
end;
$$;

-- Yükleme kaydı (Edge Function, service_role). Artık eski fotoğrafların yerine
-- geçmez; sona eklenir. Reddedilmiş eski fotoğraflar temizlenir.
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
  v_pos integer;
begin
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Aynı kullanıcının eşzamanlı yüklemeleri sırayla değerlendirilir.
  perform 1 from public.profiles where id = p_user for update;

  select coalesce(array_agg(storage_path), '{}') into v_old
  from public.profile_photos where user_id = p_user and status = 'rejected';
  delete from public.profile_photos where user_id = p_user and storage_path = any (v_old);

  if (select count(*) from public.profile_photos where user_id = p_user) >= 6 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  if (
    select count(*) from private.photo_uploads
    where user_id = p_user and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.photo_uploads (user_id) values (p_user);

  v_status := case when private.setting_bool('photo_auto_approve', true) then 'approved' else 'pending' end;
  select coalesce(max(position) + 1, 0) into v_pos from public.profile_photos where user_id = p_user;

  insert into public.profile_photos (user_id, storage_path, status, reviewed_at, position)
  values (p_user, p_path, v_status, case when v_status = 'approved' then now() end, v_pos)
  returning id into v_id;

  perform private.sync_main_photo(p_user);
  return jsonb_build_object('id', v_id, 'status', v_status, 'remove_paths', to_jsonb(v_old));
end;
$$;

-- Tek fotoğrafı sil (Edge Function, service_role); silinecek dosya yolunu döndürür.
create or replace function public.remove_profile_photo(p_user uuid, p_photo uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  delete from public.profile_photos where id = p_photo and user_id = p_user returning storage_path into v_path;
  if v_path is null then
    return '{}';
  end if;
  update public.profile_photos ph set position = x.rn
  from (select id, (row_number() over (order by position, created_at) - 1)::int as rn
        from public.profile_photos where user_id = p_user) x
  where x.id = ph.id and ph.position is distinct from x.rn;
  perform private.sync_main_photo(p_user);
  return array[v_path];
end;
$$;

-- Sıralama (kullanıcı): kendi fotoğraflarının TAMAMI, yeni sırasıyla.
create or replace function public.reorder_my_photos(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(id order by id) from public.profile_photos where user_id = v_me)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'invalid_order' using errcode = '22023';
  end if;
  update public.profile_photos ph set position = (o.ord - 1)::int
  from unnest(p_ids) with ordinality o(id, ord)
  where ph.id = o.id and ph.user_id = v_me;
  perform private.sync_main_photo(v_me);
end;
$$;

-- Storage RLS: sahibi ve yönetici her fotoğrafı; diğerleri yalnızca görebildikleri
-- profilin ONAYLI fotoğraflarını (artık yalnızca ana fotoğrafı değil).
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
        or private.is_admin(auth.uid())
        or (ph.status = 'approved' and private.profile_visible_to(ph.user_id, auth.uid()))
      )
  )
$$;

-- Fotoğraf onayı: onaylanan fotoğraf ana fotoğrafı ezmez; sıraya göre belirlenir.
create or replace function public.admin_review_photo(p_photo uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ph public.profile_photos%rowtype;
begin
  perform private.admin_audit(case when p_approve then 'photo.approve' else 'photo.reject' end, 'photo', p_photo::text);
  select * into ph from public.profile_photos where id = p_photo and status = 'pending' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.profile_photos
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_photo;
  perform private.sync_main_photo(ph.user_id);
end;
$$;

-- Profil kartı: galeri için onaylı fotoğraf yolları.
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
    'country_code', p.country_code,
    -- Kampüs: doğrulanmış öğrenci rozeti; üniversite adı yalnızca sahibi izin verdiyse.
    'student', case when private.is_verified_student(p.id) then jsonb_build_object(
      'university', case when p.show_university or p.id = p_viewer then (
        select jsonb_build_object('id', u.id, 'name_tr', u.name_tr, 'name_en', u.name_en)
        from public.universities u where u.id = p.student_university_id) end
    ) end,
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
    -- Profil galerisi: onaylı fotoğraflar, sahibinin belirlediği sırayla (ilki ana fotoğraf).
    'photo_paths', coalesce((
      select jsonb_agg(ph.storage_path order by ph.position, ph.created_at)
      from public.profile_photos ph where ph.user_id = p.id and ph.status = 'approved'
    ), '[]'::jsonb),
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

revoke execute on function private.sync_main_photo(uuid) from public, anon, authenticated;
revoke execute on function public.register_profile_photo(uuid, text) from public, anon, authenticated;
revoke execute on function public.remove_profile_photo(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reorder_my_photos(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_review_photo(uuid, boolean) from public, anon, authenticated;
grant execute on function public.register_profile_photo(uuid, text) to service_role;
grant execute on function public.remove_profile_photo(uuid, uuid) to service_role;
grant execute on function public.reorder_my_photos(uuid[]) to authenticated;
grant execute on function public.admin_review_photo(uuid, boolean) to authenticated;
