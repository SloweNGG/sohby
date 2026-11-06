-- =============================================================================
-- Sohby — 12: Yönetim paneli (yönetici rolü, işlem kaydı, yönetim RPC'leri)
-- =============================================================================
-- * Yöneticiler private.admins tablosunda (API'ye kapalı). Yönetici eklemek
--   yalnızca veritabanı sahibinin işidir (SQL Editor / migration).
-- * Yönetim paneli service_role KULLANMAZ: normal oturumla bu dosyadaki
--   RPC'leri çağırır; her RPC yönetici rolünü kendisi denetler.
-- * CLAUDE.md kural 14: Her yönetici işlemi ve her sohbet görüntüleme,
--   aynı işlem (transaction) içinde silinemez işlem kaydına yazılır. Kayıt
--   tablosu UPDATE/DELETE/TRUNCATE'i tetikleyiciyle reddeder.
-- =============================================================================

create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table private.admins enable row level security;
revoke all on private.admins from public, anon, authenticated;

create table private.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,              -- FK yok: kayıt hesaplar silinse de kalır
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table private.admin_audit_log enable row level security;
revoke all on private.admin_audit_log from public, anon, authenticated;

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_immutable' using errcode = '42501';
end;
$$;

create trigger admin_audit_log_no_update
  before update or delete on private.admin_audit_log
  for each row execute function private.audit_log_immutable();
create trigger admin_audit_log_no_truncate
  before truncate on private.admin_audit_log
  for each statement execute function private.audit_log_immutable();

create or replace function private.is_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admins where user_id = p_user)
$$;

-- Yönetici değilse reddeder; yönetici ise işlemi kayda yazar.
create or replace function private.admin_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into private.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Yöneticiler fotoğraf incelemesi için bekleyen fotoğrafları da görebilir.
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
        or (
          ph.status = 'approved'
          and exists (select 1 from public.profiles p where p.id = ph.user_id and p.photo_id = ph.id)
          and private.profile_visible_to(ph.user_id, auth.uid())
        )
      )
  )
$$;

-- -----------------------------------------------------------------------------
-- Yönetim RPC'leri (hepsi önce private.admin_audit ile yetki denetler + kaydeder)
-- -----------------------------------------------------------------------------
create or replace function public.admin_whoami()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.is_admin(auth.uid())
$$;

create or replace function private.admin_user_brief(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'account_status', p.account_status, 'deleted_at', p.deleted_at
  )
  from public.profiles p where p.id = p_user
$$;

-- Şikâyet kuyruğu
create or replace function public.admin_list_reports(p_status text default 'open')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('reports.list', null, null, jsonb_build_object('status', p_status));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at,
    'has_conversation', r.conversation_id is not null or r.anon_conversation_id is not null or r.message_request_id is not null,
    'is_anonymous', r.anon_conversation_id is not null,
    'reporter', private.admin_user_brief(r.reporter_id),
    'reported', private.admin_user_brief(r.reported_id),
    'reported_open_reports', (select count(*) from public.reports x where x.reported_id = r.reported_id and x.status in ('open','reviewing'))
  ) order by r.created_at), '[]'::jsonb)
  into v
  from public.reports r
  where (p_status = 'all' or r.status = p_status or (p_status = 'open' and r.status = 'reviewing'));
  return v;
end;
$$;

-- Şikâyet ayrıntısı + ilgili sohbet (SOHBET GÖRÜNTÜLEME → kayda yazılır).
create or replace function public.admin_get_report(p_report uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports%rowtype;
  v_messages jsonb := '[]'::jsonb;
begin
  perform private.admin_audit('report.view', 'report', p_report::text);
  select * into r from public.reports where id = p_report;
  if not found then
    return null;
  end if;

  if r.conversation_id is not null then
    perform private.admin_audit('conversation.view', 'conversation', r.conversation_id::text,
                                jsonb_build_object('report_id', p_report));
    select coalesce(jsonb_agg(jsonb_build_object('sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at)
                              order by m.created_at), '[]'::jsonb)
      into v_messages
      from public.messages m where m.conversation_id = r.conversation_id;
  elsif r.anon_conversation_id is not null then
    perform private.admin_audit('anon_conversation.view', 'anon_conversation', r.anon_conversation_id::text,
                                jsonb_build_object('report_id', p_report));
    select coalesce(jsonb_agg(jsonb_build_object(
             'sender_id', case when m.from_anonymous then s.sender_id else c.recipient_id end,
             'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
      into v_messages
      from public.anon_messages m
      join public.anon_conversations c on c.id = m.conversation_id
      join private.anon_senders s on s.conversation_id = c.id
     where m.conversation_id = r.anon_conversation_id;
  elsif r.message_request_id is not null then
    perform private.admin_audit('message_request.view', 'message_request', r.message_request_id::text,
                                jsonb_build_object('report_id', p_report));
    select coalesce(jsonb_agg(jsonb_build_object('sender_id', mr.sender_id, 'body', mr.body, 'created_at', mr.created_at)), '[]'::jsonb)
      into v_messages
      from public.message_requests mr where mr.id = r.message_request_id;
  end if;

  return jsonb_build_object(
    'id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at,
    'is_anonymous', r.anon_conversation_id is not null,
    'reporter', private.admin_user_brief(r.reporter_id),
    'reported', private.admin_user_brief(r.reported_id),
    'messages', v_messages
  );
end;
$$;

create or replace function public.admin_resolve_report(p_report uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform private.admin_audit('report.' || p_status, 'report', p_report::text,
                              jsonb_build_object('note', left(coalesce(p_note, ''), 1000)));
  update public.reports set status = p_status where id = p_report;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Fotoğraf onayı
create or replace function public.admin_list_pending_photos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('photos.list');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ph.id, 'storage_path', ph.storage_path, 'created_at', ph.created_at,
    'user', private.admin_user_brief(ph.user_id)) order by ph.created_at), '[]'::jsonb)
  into v
  from public.profile_photos ph where ph.status = 'pending';
  return v;
end;
$$;

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
  if p_approve then
    update public.profiles set photo_id = p_photo where id = ph.user_id;
  end if;
end;
$$;

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_audit('settings.view');
  return jsonb_build_object('photo_auto_approve', private.setting_bool('photo_auto_approve', true));
end;
$$;

create or replace function public.admin_set_photo_auto_approve(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_audit('settings.photo_auto_approve', 'setting', 'photo_auto_approve',
                              jsonb_build_object('enabled', p_enabled));
  insert into private.app_settings (key, value, updated_at)
  values ('photo_auto_approve', to_jsonb(coalesce(p_enabled, true)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Kullanıcılar
create or replace function public.admin_list_users(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v jsonb;
begin
  perform private.admin_audit('users.list', null, null,
                              jsonb_build_object('search', v_search, 'status', p_status));
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into v
  from (
    select p.id, p.username, p.display_name, u.email, p.account_status, p.status_reason, p.suspended_until,
           p.deleted_at, p.created_at, p.onboarding_completed_at,
           (select count(*) from public.reports r where r.reported_id = p.id) as report_count
    from public.profiles p
    join auth.users u on u.id = p.id
    where (v_search is null or position(v_search in p.username) > 0
           or position(v_search in lower(coalesce(p.display_name, ''))) > 0
           or position(v_search in lower(coalesce(u.email, ''))) > 0)
      and (p_status is null or p.account_status = p_status)
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0)
  ) x;
  return v;
end;
$$;

create or replace function public.admin_set_user_status(
  p_user uuid,
  p_status text,
  p_reason text default null,
  p_suspended_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('active', 'age_verification_required', 'suspended', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'suspended' and p_suspended_until is not null and p_suspended_until <= now() then
    raise exception 'invalid_until' using errcode = '22023';
  end if;
  perform private.admin_audit('user.status', 'user', p_user::text, jsonb_build_object(
    'status', p_status, 'reason', left(coalesce(p_reason, ''), 500), 'suspended_until', p_suspended_until));
  update public.profiles
     set account_status = p_status,
         status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
         suspended_until = case when p_status = 'suspended' then p_suspended_until end,
         status_changed_at = now()
   where id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- İtirazlar
create or replace function public.admin_list_appeals(p_status text default 'open')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('appeals.list', null, null, jsonb_build_object('status', p_status));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'message', a.message, 'status', a.status, 'account_status', a.account_status,
    'created_at', a.created_at, 'user', private.admin_user_brief(a.user_id)) order by a.created_at), '[]'::jsonb)
  into v
  from public.appeals a where p_status = 'all' or a.status = p_status;
  return v;
end;
$$;

create or replace function public.admin_review_appeal(p_appeal uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appeals%rowtype;
begin
  perform private.admin_audit(case when p_accept then 'appeal.accept' else 'appeal.reject' end, 'appeal', p_appeal::text);
  select * into a from public.appeals where id = p_appeal and status = 'open' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.appeals
     set status = case when p_accept then 'accepted' else 'rejected' end, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_appeal;
  if p_accept then
    update public.profiles
       set account_status = 'active', status_reason = null, suspended_until = null, status_changed_at = now()
     where id = a.user_id;
  end if;
end;
$$;

-- İşlem kaydı (yalnızca okuma)
create or replace function public.admin_list_audit(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.admin_audit('audit.view');
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.id desc), '[]'::jsonb)
  into v
  from (
    select l.id, l.admin_id, p.username as admin_username, l.action, l.target_type, l.target_id, l.details, l.created_at
    from private.admin_audit_log l
    left join public.profiles p on p.id = l.admin_id
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) x;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.audit_log_immutable() from public, anon, authenticated;
revoke execute on function private.is_admin(uuid) from public, anon, authenticated;
revoke execute on function private.admin_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.admin_user_brief(uuid) from public, anon, authenticated;
revoke execute on function public.admin_whoami() from public, anon, authenticated;
revoke execute on function public.admin_list_reports(text) from public, anon, authenticated;
revoke execute on function public.admin_get_report(uuid) from public, anon, authenticated;
revoke execute on function public.admin_resolve_report(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_list_pending_photos() from public, anon, authenticated;
revoke execute on function public.admin_review_photo(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_get_settings() from public, anon, authenticated;
revoke execute on function public.admin_set_photo_auto_approve(boolean) from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_set_user_status(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_list_appeals(text) from public, anon, authenticated;
revoke execute on function public.admin_review_appeal(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_list_audit(integer) from public, anon, authenticated;

-- Giriş yapmış herkes çağırabilir; fonksiyonlar yönetici rolünü kendisi denetler.
grant execute on function public.admin_whoami() to authenticated;
grant execute on function public.admin_list_reports(text) to authenticated;
grant execute on function public.admin_get_report(uuid) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
grant execute on function public.admin_list_pending_photos() to authenticated;
grant execute on function public.admin_review_photo(uuid, boolean) to authenticated;
grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_set_photo_auto_approve(boolean) to authenticated;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_list_appeals(text) to authenticated;
grant execute on function public.admin_review_appeal(uuid, boolean) to authenticated;
grant execute on function public.admin_list_audit(integer) to authenticated;
