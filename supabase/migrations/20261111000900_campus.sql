-- =============================================================================
-- Kampüs: doğrulanmış öğrenciler (ilk üniversite: Pamukkale Üniversitesi)
-- =============================================================================
-- Kullanıcı kararları (2026-11-11):
--  * Doğrulama: öğrenci kimlik kartının fotoğrafı yüklenir, yönetici onaylar.
--  * Yalnızca öğrenciler. Onay 1 yıl geçerli; süre dolunca rozet kalkar.
--  * Onaylanan profilde "Doğrulanmış öğrenci" rozeti (+ istenirse üniversite).
--  * Kampüs uygulamanın bir parçası; kullanıcı genel Keşfet'te görünüp
--    görünmeyeceğini seçer (varsayılan: görünür, üniversite adı görünür).
--
-- Belgeler (CLAUDE.md kural 16, yaş belgeleriyle aynı koruma):
--  * `student-documents` bucket'ında, `student-documents` Edge Function'ı
--    tarafından AES-256-GCM ile şifreli (anahtar STUDENT_DOC_KEY, yalnızca
--    fonksiyon ortamında). Bucket'ın hiçbir erişim kuralı yok.
--  * Görüntüleme 60 saniyelik belirteçle, her görüntüleme işlem kaydında.
--  * İnceleme bitince en geç 7 gün, incelenmezse yüklemeden 30 gün sonra silinir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Üniversiteler (herkese açık bilgi)
-- -----------------------------------------------------------------------------
create table public.universities (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name_tr text not null check (char_length(name_tr) between 2 and 120),
  name_en text not null check (char_length(name_en) between 2 and 120),
  city text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.universities enable row level security;
revoke all on public.universities from public, anon, authenticated;
grant select on public.universities to authenticated;
create policy "universities: açık olanlar okunur"
  on public.universities for select to authenticated using (active);

insert into public.universities (id, name_tr, name_en, city)
values ('pau', 'Pamukkale Üniversitesi', 'Pamukkale University', 'Denizli');

-- -----------------------------------------------------------------------------
-- Profil: öğrenci bilgisi (yalnızca yönetici onayı yazar) ve görünürlük
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column student_university_id text references public.universities (id) on delete set null,
  add column student_verified_until timestamptz,
  add column show_university boolean not null default true,
  add column show_outside_campus boolean not null default true;

-- Kullanıcı yalnızca görünürlük ayarlarını değiştirebilir; öğrenci bilgisini değil.
grant update (show_university, show_outside_campus) on public.profiles to authenticated;

create or replace function private.is_verified_student(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.student_university_id is not null and p.student_verified_until > now()
    from public.profiles p where p.id = p_user
  ), false)
$$;

-- -----------------------------------------------------------------------------
-- Başvuru (hangi üniversite) ve belgeler
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-documents', 'student-documents', false, 6 * 1024 * 1024, array['application/octet-stream'])
on conflict (id) do nothing;

-- Kullanıcının seçtiği üniversite (belge yüklemeden önce). Belge fonksiyonu
-- yalnızca dosyayı alır; üniversiteyi buradan okur.
create table private.student_applications (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  university_id text not null references public.universities (id),
  created_at timestamptz not null default now()
);
alter table private.student_applications enable row level security;
revoke all on private.student_applications from public, anon, authenticated;

create table private.student_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  university_id text not null references public.universities (id),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  review_note text check (char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  delete_after timestamptz not null default now() + interval '30 days',
  reviewed_at timestamptz,
  reviewed_by uuid,
  file_deleted_at timestamptz
);
alter table private.student_documents enable row level security;
revoke all on private.student_documents from public, anon, authenticated;
create unique index student_documents_one_pending on private.student_documents (user_id) where status = 'pending';
create index student_documents_status_idx on private.student_documents (status, created_at);

create table private.student_document_tokens (
  token_hash text primary key,
  document_id uuid not null references private.student_documents (id) on delete cascade,
  admin_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table private.student_document_tokens enable row level security;
revoke all on private.student_document_tokens from public, anon, authenticated;

create or replace function private.student_document_available(d private.student_documents)
returns boolean
language sql
stable
set search_path = ''
as $$
  select d.file_deleted_at is null and d.delete_after > now()
$$;

-- -----------------------------------------------------------------------------
-- Kullanıcı
-- -----------------------------------------------------------------------------
-- Kampüs durumu: doğrulama, süre, son başvurunun durumu (dosya yolu yok).
create or replace function public.get_my_campus()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'verified', private.is_verified_student(p.id),
    'verified_until', p.student_verified_until,
    'university', (select jsonb_build_object('id', u.id, 'name_tr', u.name_tr, 'name_en', u.name_en, 'city', u.city)
                   from public.universities u where u.id = p.student_university_id),
    'show_university', p.show_university,
    'show_outside_campus', p.show_outside_campus,
    'latest', (
      select jsonb_build_object(
        'status', d.status,
        'university_id', d.university_id,
        'created_at', d.created_at,
        'reviewed_at', d.reviewed_at,
        'review_note', case when d.status = 'rejected' then d.review_note end
      )
      from private.student_documents d
      where d.user_id = p.id
      order by d.created_at desc
      limit 1
    )
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

-- Üniversite seçimi (belge yüklemeden önce).
create or replace function public.start_student_verification(p_university text)
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
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.universities where id = p_university and active) then
    raise exception 'invalid_university' using errcode = '22023';
  end if;
  insert into private.student_applications (user_id, university_id)
  values (v_me, p_university)
  on conflict (user_id) do update set university_id = excluded.university_id, created_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Edge Function (service_role) için
-- -----------------------------------------------------------------------------
-- Yükleme izni: aktif hesap, üniversite seçilmiş; doğrulaması yoksa ya da
-- bitmesine 14 günden az kaldıysa; tek bekleyen belge; 24 saatte en çok 3.
create or replace function public.student_document_upload_check(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user(p_user)
     or exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.student_applications a
    join public.universities u on u.id = a.university_id and u.active
    where a.user_id = p_user
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles
    where id = p_user and student_verified_until > now() + interval '14 days'
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.student_documents
    where user_id = p_user and status = 'pending' and delete_after > now()
  ) then
    raise exception 'already_pending' using errcode = '42501';
  end if;
  if (select count(*) from private.student_documents
      where user_id = p_user and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.register_student_document(
  p_user uuid,
  p_document uuid,
  p_path text,
  p_content_type text,
  p_size integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_university text;
begin
  perform 1 from public.profiles where id = p_user for update;
  update private.student_documents set status = 'expired'
   where user_id = p_user and status = 'pending' and delete_after <= now();
  perform public.student_document_upload_check(p_user);
  select university_id into v_university from private.student_applications where user_id = p_user;
  insert into private.student_documents (id, user_id, university_id, storage_path, content_type, size_bytes)
  values (p_document, p_user, v_university, p_path, p_content_type, p_size);
  return p_document;
end;
$$;

create or replace function public.resolve_student_document_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'content_type', d.content_type)
  from private.student_document_tokens t
  join private.student_documents d on d.id = t.document_id
  where t.token_hash = private.sha256_hex(coalesce(p_token, ''))
    and t.expires_at > now()
    and private.student_document_available(d)
$$;

create or replace function public.student_documents_due()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'storage_path', d.storage_path)), '[]'::jsonb)
  from private.student_documents d
  where d.delete_after <= now() and d.file_deleted_at is null
$$;

create or replace function public.mark_student_documents_deleted(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  update private.student_documents
     set file_deleted_at = now(),
         status = case when status = 'pending' then 'expired' else status end
   where id = any(p_ids) and file_deleted_at is null;
  get diagnostics v = row_count;
  delete from private.student_document_tokens where document_id = any(p_ids);
  return v;
end;
$$;

-- Saatlik görev: süresi dolanları görüntülenemez yap, sonra fonksiyonu çağır.
create or replace function private.student_documents_hourly()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_url text;
  v_token text;
  v_called boolean := false;
begin
  update private.student_documents set status = 'expired'
   where status = 'pending' and delete_after <= now();
  get diagnostics v_expired = row_count;
  delete from private.student_document_tokens where expires_at < now() - interval '1 day';

  select value #>> '{}' into v_url from private.app_settings where key = 'functions_base_url';
  select value #>> '{}' into v_token from private.app_settings where key = 'cron_token';
  if v_url is not null and v_token is not null and to_regnamespace('net') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url || '/functions/v1/student-documents/purge',
            '{}'::jsonb,
            jsonb_build_object('x-sohby-cron', v_token, 'Content-Type', 'application/json');
    v_called := true;
  end if;
  return jsonb_build_object('expired', v_expired, 'purge_requested', v_called);
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sohby-student-documents', '47 * * * *', 'select private.student_documents_hourly()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yönetim (her çağrı private.admin_audit ile yetki denetler ve kayda yazar)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_student_documents(p_status text default 'pending')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('student_documents.list', null, null, jsonb_build_object('status', p_status));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'created_at', d.created_at,
    'delete_after', d.delete_after,
    'reviewed_at', d.reviewed_at,
    'review_note', d.review_note,
    'file_available', private.student_document_available(d),
    'university', jsonb_build_object('id', u.id, 'name', u.name_tr),
    'user', private.admin_user_brief(d.user_id)
      || jsonb_build_object('display_name', p.display_name, 'birth_date', pp.birth_date)
  ) order by d.created_at), '[]'::jsonb)
  into v
  from private.student_documents d
  join public.universities u on u.id = d.university_id
  left join public.profiles p on p.id = d.user_id
  left join public.profile_private pp on pp.id = d.user_id
  where case when p_status = 'all' then true else d.status = p_status end;
  return v;
end;
$$;

create or replace function public.admin_open_student_document(p_document uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d private.student_documents%rowtype;
  v_token text;
begin
  perform private.admin_audit('student_document.view', 'student_document', p_document::text);
  select * into d from private.student_documents where id = p_document;
  if not found or not private.student_document_available(d) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into private.student_document_tokens (token_hash, document_id, admin_id, expires_at)
  values (private.sha256_hex(v_token), d.id, auth.uid(), now() + interval '60 seconds');
  return v_token;
end;
$$;

-- Onay: öğrenci 1 yıl doğrulanmış olur. Ret: sebep kullanıcıya gösterilir.
-- Her iki durumda da belge en geç 7 gün içinde silinir.
create or replace function public.admin_review_student_document(p_document uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d private.student_documents%rowtype;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform private.admin_audit(
    case when p_approve then 'student_document.approve' else 'student_document.reject' end,
    'student_document', p_document::text, jsonb_build_object('note', v_note));
  select * into d from private.student_documents where id = p_document and status = 'pending' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not p_approve and v_note is null then
    raise exception 'note_required' using errcode = '22023';
  end if;
  update private.student_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = v_note,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         delete_after = least(delete_after, now() + interval '7 days')
   where id = p_document;
  if p_approve then
    update public.profiles
       set student_university_id = d.university_id,
           student_verified_until = now() + interval '1 year'
     where id = d.user_id;
  end if;
end;
$$;

-- Doğrulamayı geri al (ör. sahte belge sonradan anlaşıldı).
create or replace function public.admin_revoke_student(p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform private.admin_audit('student.revoke', 'user', p_user::text, jsonb_build_object('note', v_note));
  if v_note is null then
    raise exception 'note_required' using errcode = '22023';
  end if;
  update public.profiles set student_university_id = null, student_verified_until = null where id = p_user;
end;
$$;

-- Menüdeki bekleyen iş sayıları: öğrenci belgeleri de.
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
    'student_documents', (select count(*) from private.student_documents where status = 'pending'),
    'appeals', (select count(*) from public.appeals where status = 'open')
  )
$$;

-- -----------------------------------------------------------------------------
-- Profil kartı (rozet), Keşfet (kampüs kipi), filtre listeleri
-- -----------------------------------------------------------------------------
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

drop function public.discover_profiles(text, text, integer, integer, integer, integer, text, text, text, text);

create or replace function public.discover_profiles(
  p_filter text default 'all',
  p_search text default null,
  p_min_age integer default null,
  p_max_age integer default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_country text default null,
  p_city_key text default null,
  p_gender text default null,
  p_language text default null,
  p_campus boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_me_city_key text;
  v_me_district text;
  v_me_university text;
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_result jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if coalesce(p_filter, 'all') not in ('all', 'nearby', 'common_hobby', 'online', 'flirt') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  -- Flört filtresi yalnızca flört seçmiş (açık rıza vermiş) kullanıcıya açıktır.
  if p_filter = 'flirt' and not private.wants_flirt(v_me) then
    raise exception 'flirt_not_allowed' using errcode = '42501';
  end if;
  p_country := upper(nullif(btrim(coalesce(p_country, '')), ''));
  p_city_key := nullif(btrim(coalesce(p_city_key, '')), '');
  p_gender := nullif(btrim(coalesce(p_gender, '')), '');
  p_language := nullif(btrim(coalesce(p_language, '')), '');
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_city_key is not null and char_length(p_city_key) > 80 then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_gender is not null and p_gender not in ('female', 'male', 'other') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_language is not null and p_language !~ '^[a-z]{2}$' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  -- Kampüs Keşfet'i yalnızca doğrulanmış öğrencilere açık.
  if coalesce(p_campus, false) then
    if not private.is_verified_student(v_me) then
      raise exception 'campus_not_allowed' using errcode = '42501';
    end if;
    select student_university_id into v_me_university from public.profiles where id = v_me;
  end if;
  if v_search is not null and char_length(v_search) > 50 then
    v_search := left(v_search, 50);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 10000);

  select city_key, lower(district) into v_me_city_key, v_me_district
  from public.profiles where id = v_me;

  with candidates as (
    select
      p.id, p.country_code, p.city, p.city_key, p.district, p.gender, p.show_gender, p.languages, p.show_district, p.show_age, p.created_at, p.last_seen_at,
      private.age_years(pp.birth_date) as age,
      private.is_online(p.show_online, p.last_seen_at) as online,
      private.common_hobby_count(p.id, v_me) as common_count,
      p.display_name, p.username, p.show_outside_campus, p.student_university_id
    from public.profiles p
    join public.profile_private pp on pp.id = p.id
    where p.id <> v_me
      and p.show_in_discover
      and p.onboarding_completed_at is not null
      and p.deleted_at is null
      and private.is_adult_birth_date(pp.birth_date)
      and private.status_is_active(p.account_status, p.suspended_until)
      and not private.is_blocked_between(v_me, p.id)
      and not private.anon_blocked(p.id, v_me)
      and (
        -- Kampüs: aynı üniversitenin doğrulanmış öğrencileri.
        (coalesce(p_campus, false) and private.is_verified_student(p.id) and p.student_university_id = v_me_university)
        -- Genel Keşfet: "Kampüs dışında da görün" kapalı olanlar çıkmaz.
        or (not coalesce(p_campus, false) and p.show_outside_campus)
      )
  ),
  filtered as (
    select c.*,
      row_number() over (
        order by
          -- Her sekmede ve filtrede önce çevrimiçi olanlar.
          c.online desc,
          case
            when p_filter = 'nearby' and c.show_district
             and v_me_district is not null and lower(c.district) = v_me_district then 0
            else 1
          end,
          c.common_count desc, c.last_seen_at desc nulls last, c.created_at desc, c.id
      ) as rn
    from candidates c
    where (coalesce(p_filter, 'all') <> 'nearby'
           or (v_me_city_key is not null and c.city_key = v_me_city_key))
      and (coalesce(p_filter, 'all') <> 'common_hobby' or c.common_count > 0)
      and (coalesce(p_filter, 'all') <> 'online' or c.online)
      and (coalesce(p_filter, 'all') <> 'flirt' or private.flirt_compatible(v_me, c.id))
      and (p_country is null or c.country_code = p_country)
      and (p_city_key is null or c.city_key = p_city_key)
      -- Cinsiyetini gizleyenler cinsiyet filtresinde görünmez (yaşta olduğu gibi).
      and (p_gender is null or (c.show_gender and c.gender = p_gender))
      and (p_language is null or p_language = any (c.languages))
      and (p_min_age is null or (c.show_age and c.age >= p_min_age))
      and (p_max_age is null or (c.show_age and c.age <= p_max_age))
      and (
        v_search is null
        or position(v_search in lower(coalesce(c.display_name, ''))) > 0
        or position(v_search in c.username) > 0
        or position(v_search in lower(coalesce(c.city, ''))) > 0
        or (c.show_district and position(v_search in lower(coalesce(c.district, ''))) > 0)
        or exists (
          select 1 from public.profile_hobbies ph
          join public.hobbies h on h.id = ph.hobby_id
          where ph.profile_id = c.id
            and (position(v_search in lower(h.name_tr)) > 0 or position(v_search in lower(h.name_en)) > 0)
        )
      )
  )
  select coalesce(jsonb_agg(private.profile_card(f.id, v_me) order by f.rn), '[]'::jsonb)
  into v_result
  from filtered f
  where f.rn > p_offset and f.rn <= p_offset + p_limit;

  return v_result;
end;
$$;

create or replace function public.discover_places()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('country', x.country_code, 'key', x.city_key, 'city', x.city)
                     order by x.country_code, x.city)
    from (
      select distinct on (p.city_key) p.country_code, p.city_key, p.city
      from public.profiles p
      join public.profile_private pp on pp.id = p.id
      where p.id <> v_me
        and p.city_key is not null
        and p.show_in_discover
        and p.onboarding_completed_at is not null
        and p.deleted_at is null
        and private.is_adult_birth_date(pp.birth_date)
        and private.status_is_active(p.account_status, p.suspended_until)
        and not private.is_blocked_between(v_me, p.id)
        and not private.anon_blocked(p.id, v_me)
        and p.show_outside_campus
      order by p.city_key, p.city
      limit 3000
    ) x
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.is_verified_student(uuid) from public, anon, authenticated;
revoke execute on function private.student_document_available(private.student_documents) from public, anon, authenticated;
revoke execute on function private.student_documents_hourly() from public, anon, authenticated;
revoke execute on function public.get_my_campus() from public, anon, authenticated;
revoke execute on function public.start_student_verification(text) from public, anon, authenticated;
revoke execute on function public.student_document_upload_check(uuid) from public, anon, authenticated;
revoke execute on function public.register_student_document(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.resolve_student_document_token(text) from public, anon, authenticated;
revoke execute on function public.student_documents_due() from public, anon, authenticated;
revoke execute on function public.mark_student_documents_deleted(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_list_student_documents(text) from public, anon, authenticated;
revoke execute on function public.admin_open_student_document(uuid) from public, anon, authenticated;
revoke execute on function public.admin_review_student_document(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.admin_revoke_student(uuid, text) from public, anon, authenticated;
revoke execute on function public.discover_profiles(text, text, integer, integer, integer, integer, text, text, text, text, boolean) from public, anon;

grant execute on function public.get_my_campus() to authenticated;
grant execute on function public.start_student_verification(text) to authenticated;
grant execute on function public.admin_list_student_documents(text) to authenticated;
grant execute on function public.admin_open_student_document(uuid) to authenticated;
grant execute on function public.admin_review_student_document(uuid, boolean, text) to authenticated;
grant execute on function public.admin_revoke_student(uuid, text) to authenticated;
grant execute on function public.discover_profiles(text, text, integer, integer, integer, integer, text, text, text, text, boolean) to authenticated;

grant execute on function public.student_document_upload_check(uuid) to service_role;
grant execute on function public.register_student_document(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.resolve_student_document_token(text) to service_role;
grant execute on function public.student_documents_due() to service_role;
grant execute on function public.mark_student_documents_deleted(uuid[]) to service_role;
