-- =============================================================================
-- Sohby — 15: Yaş doğrulama belgeleri
-- =============================================================================
-- CLAUDE.md kural 15: Yaş doğrulama belgeleri şifreli ve ayrı bir bucket'ta
-- tutulur, inceleme bittikten sonra en geç 30 gün içinde silinir.
-- Kullanıcı kararı: belgeler yalnızca yöneticilerin erişebildiği gizli bir
-- bucket'ta durur, görüntüleme kısa ömürlü bağlantılarla olur, her görüntüleme
-- işlem kaydına yazılır, belgeler 30 gün sonra otomatik silinir.
--
-- Tasarım:
--  * Dosyalar `age-documents` bucket'ında, `age-documents` Edge Function'ı
--    tarafından AES-256-GCM ile ŞİFRELENMİŞ olarak durur. Anahtar veritabanında
--    değil, yalnızca fonksiyonun ortamındadır (AGE_DOC_KEY).
--  * Bucket'ın hiçbir erişim kuralı yoktur: kullanıcılar da yöneticiler de
--    depolamaya doğrudan erişemez; tek yol fonksiyondur.
--  * Kayıtlar API'ye kapalı `private.age_documents` tablosunda. Kullanıcı yalnızca
--    kendi son belgesinin durumunu görür (dosya yolu dönmez).
--  * Görüntüleme: yönetici `admin_open_age_document` çağırır → işlem kaydı +
--    60 saniyelik bağlantı belirteci. Fonksiyon belirteci doğrulayıp şifreyi çözer.
--  * Silme: belge yüklendikten 30 gün sonra (inceleme bitmiş olsun olmasın)
--    veritabanı onu hemen "görüntülenemez" yapar; saatlik görev fonksiyonu
--    çağırır ve dosya Storage API ile fiziksel olarak silinir. (Supabase,
--    storage.objects üzerinden doğrudan silmeye izin vermez.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bucket: gizli, hiçbir erişim kuralı yok (yalnızca service_role).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('age-documents', 'age-documents', false, 6 * 1024 * 1024, array['application/octet-stream'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Kayıtlar
-- -----------------------------------------------------------------------------
create table private.age_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  review_note text check (char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  -- 30 gün kuralı: bu andan sonra belge görüntülenemez ve dosya silinir.
  delete_after timestamptz not null default now() + interval '30 days',
  reviewed_at timestamptz,
  reviewed_by uuid,
  file_deleted_at timestamptz
);
alter table private.age_documents enable row level security;
revoke all on private.age_documents from public, anon, authenticated;
create unique index age_documents_one_pending on private.age_documents (user_id) where status = 'pending';
create index age_documents_status_idx on private.age_documents (status, created_at);

-- Görüntüleme belirteçleri: yalnızca özet (sha256) saklanır, 60 saniye geçerli.
create table private.age_document_tokens (
  token_hash text primary key,
  document_id uuid not null references private.age_documents (id) on delete cascade,
  admin_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table private.age_document_tokens enable row level security;
revoke all on private.age_document_tokens from public, anon, authenticated;

-- Zamanlanmış silme görevinin fonksiyonu çağırırken kullandığı belirteç.
-- Değer migration dosyasında DEĞİL, uygulama anında veritabanında üretilir.
insert into private.app_settings (key, value)
values ('cron_token', to_jsonb(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

create or replace function private.sha256_hex(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

-- Dosya hâlâ görüntülenebilir mi? (30 gün dolmamış ve silinmemiş)
create or replace function private.age_document_available(d private.age_documents)
returns boolean
language sql
stable
set search_path = ''
as $$
  select d.file_deleted_at is null and d.delete_after > now()
$$;

-- -----------------------------------------------------------------------------
-- Kullanıcı: kendi son belgesinin durumu (dosya yolu ya da yönetici bilgisi yok)
-- -----------------------------------------------------------------------------
create or replace function public.get_my_age_verification()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'required', coalesce((select p.account_status = 'age_verification_required' and p.deleted_at is null
                          from public.profiles p where p.id = auth.uid()), false),
    'latest', (
      select jsonb_build_object(
        'status', d.status,
        'created_at', d.created_at,
        'reviewed_at', d.reviewed_at,
        'review_note', case when d.status = 'rejected' then d.review_note end
      )
      from private.age_documents d
      where d.user_id = auth.uid()
      order by d.created_at desc
      limit 1
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- Edge Function (service_role) için
-- -----------------------------------------------------------------------------

-- Yükleme izni: yalnızca yaş doğrulaması istenmiş, silinmemiş hesap; aynı anda
-- tek bekleyen belge; 24 saatte en çok 3 yükleme.
create or replace function public.age_document_upload_check(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_user and account_status = 'age_verification_required' and deleted_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.age_documents
    where user_id = p_user and status = 'pending' and delete_after > now()
  ) then
    raise exception 'already_pending' using errcode = '42501';
  end if;
  if (select count(*) from private.age_documents
      where user_id = p_user and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.register_age_document(
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
begin
  -- Aynı kullanıcı için eşzamanlı yüklemeler sırayla değerlendirilir.
  perform 1 from public.profiles where id = p_user for update;
  -- Süresi dolmuş bekleyen belge yeni yüklemeyi engellemesin.
  update private.age_documents set status = 'expired'
   where user_id = p_user and status = 'pending' and delete_after <= now();
  perform public.age_document_upload_check(p_user);
  insert into private.age_documents (id, user_id, storage_path, content_type, size_bytes)
  values (p_document, p_user, p_path, p_content_type, p_size);
  return p_document;
end;
$$;

-- Görüntüleme belirtecini çöz: geçerliyse dosya bilgisi, değilse null.
create or replace function public.resolve_age_document_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'content_type', d.content_type)
  from private.age_document_tokens t
  join private.age_documents d on d.id = t.document_id
  where t.token_hash = private.sha256_hex(coalesce(p_token, ''))
    and t.expires_at > now()
    and private.age_document_available(d)
$$;

-- Zamanlanmış görev belirtecini doğrula.
create or replace function public.verify_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.sha256_hex(value #>> '{}') = private.sha256_hex(coalesce(p_token, ''))
       from private.app_settings where key = 'cron_token'),
    false)
$$;

-- Silinmesi gereken dosyalar (30 gün dolmuş, henüz silinmemiş).
create or replace function public.age_documents_due()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'storage_path', d.storage_path)), '[]'::jsonb)
  from private.age_documents d
  where d.delete_after <= now() and d.file_deleted_at is null
$$;

create or replace function public.mark_age_documents_deleted(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  update private.age_documents
     set file_deleted_at = now(),
         status = case when status = 'pending' then 'expired' else status end
   where id = any(p_ids) and file_deleted_at is null;
  get diagnostics v = row_count;
  delete from private.age_document_tokens where document_id = any(p_ids);
  return v;
end;
$$;

-- Fonksiyon kendi adresini kaydeder (zamanlanmış görevin onu çağırabilmesi için).
-- Adres gizli değildir; migration'a proje adresi yazılmasın diye böyle.
create or replace function public.remember_functions_base_url(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_url is null or p_url !~ '^https?://[A-Za-z0-9.:-]+$' or char_length(p_url) > 200 then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  insert into private.app_settings (key, value, updated_at)
  values ('functions_base_url', to_jsonb(p_url), now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  where private.app_settings.value is distinct from excluded.value;
end;
$$;

-- -----------------------------------------------------------------------------
-- Saatlik görev: süresi dolanları görüntülenemez yap, sonra fonksiyonu çağır.
-- -----------------------------------------------------------------------------
create or replace function private.age_documents_hourly()
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
  update private.age_documents set status = 'expired'
   where status = 'pending' and delete_after <= now();
  get diagnostics v_expired = row_count;
  delete from private.age_document_tokens where expires_at < now() - interval '1 day';

  select value #>> '{}' into v_url from private.app_settings where key = 'functions_base_url';
  select value #>> '{}' into v_token from private.app_settings where key = 'cron_token';
  -- pg_net yalnızca Supabase'te var; yerel testte çağrı atlanır.
  if v_url is not null and v_token is not null and to_regnamespace('net') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url || '/functions/v1/age-documents/purge',
            '{}'::jsonb,
            jsonb_build_object('x-sohby-cron', v_token, 'Content-Type', 'application/json');
    v_called := true;
  end if;
  return jsonb_build_object('expired', v_expired, 'purge_requested', v_called);
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sohby-age-documents', '41 * * * *', 'select private.age_documents_hourly()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yönetim (her çağrı private.admin_audit ile yetki denetler ve kayda yazar)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_age_documents(p_status text default 'pending')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('age_documents.list', null, null, jsonb_build_object('status', p_status));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'created_at', d.created_at,
    'delete_after', d.delete_after,
    'reviewed_at', d.reviewed_at,
    'review_note', d.review_note,
    'file_available', private.age_document_available(d),
    'user', private.admin_user_brief(d.user_id) || jsonb_build_object('birth_date', pp.birth_date)
  ) order by d.created_at), '[]'::jsonb)
  into v
  from private.age_documents d
  left join public.profile_private pp on pp.id = d.user_id
  where case when p_status = 'all' then true else d.status = p_status end;
  return v;
end;
$$;

-- Görüntüleme: işlem kaydı + 60 saniyelik belirteç (yalnızca bir kez döner).
create or replace function public.admin_open_age_document(p_document uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d private.age_documents%rowtype;
  v_token text;
begin
  perform private.admin_audit('age_document.view', 'age_document', p_document::text);
  select * into d from private.age_documents where id = p_document;
  if not found or not private.age_document_available(d) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into private.age_document_tokens (token_hash, document_id, admin_id, expires_at)
  values (private.sha256_hex(v_token), d.id, auth.uid(), now() + interval '60 seconds');
  return v_token;
end;
$$;

create or replace function public.admin_review_age_document(p_document uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d private.age_documents%rowtype;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform private.admin_audit(
    case when p_approve then 'age_document.approve' else 'age_document.reject' end,
    'age_document', p_document::text, jsonb_build_object('note', v_note));
  select * into d from private.age_documents where id = p_document and status = 'pending' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update private.age_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = v_note,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_document;
  -- Onay: hesap yeniden açılır (yalnızca hâlâ yaş doğrulaması bekliyorsa).
  -- Ret: hesap kapalı kalır; kullanıcı yeni belge yükleyebilir. Kalıcı kapatma
  -- gerekirse yönetici "Kullanıcılar" ekranından ayrıca yapar.
  if p_approve then
    update public.profiles
       set account_status = 'active', status_reason = null, suspended_until = null, status_changed_at = now()
     where id = d.user_id and account_status = 'age_verification_required';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.sha256_hex(text) from public, anon, authenticated;
revoke execute on function private.age_document_available(private.age_documents) from public, anon, authenticated;
revoke execute on function private.age_documents_hourly() from public, anon, authenticated;
revoke execute on function public.get_my_age_verification() from public, anon, authenticated;
revoke execute on function public.age_document_upload_check(uuid) from public, anon, authenticated;
revoke execute on function public.register_age_document(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.resolve_age_document_token(text) from public, anon, authenticated;
revoke execute on function public.verify_cron_token(text) from public, anon, authenticated;
revoke execute on function public.age_documents_due() from public, anon, authenticated;
revoke execute on function public.mark_age_documents_deleted(uuid[]) from public, anon, authenticated;
revoke execute on function public.remember_functions_base_url(text) from public, anon, authenticated;
revoke execute on function public.admin_list_age_documents(text) from public, anon, authenticated;
revoke execute on function public.admin_open_age_document(uuid) from public, anon, authenticated;
revoke execute on function public.admin_review_age_document(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.get_my_age_verification() to authenticated;
grant execute on function public.admin_list_age_documents(text) to authenticated;
grant execute on function public.admin_open_age_document(uuid) to authenticated;
grant execute on function public.admin_review_age_document(uuid, boolean, text) to authenticated;

grant execute on function public.age_document_upload_check(uuid) to service_role;
grant execute on function public.register_age_document(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.resolve_age_document_token(text) to service_role;
grant execute on function public.verify_cron_token(text) to service_role;
grant execute on function public.age_documents_due() to service_role;
grant execute on function public.mark_age_documents_deleted(uuid[]) to service_role;
grant execute on function public.remember_functions_base_url(text) to service_role;
