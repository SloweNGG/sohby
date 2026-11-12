-- =============================================================================
-- Sohby — Sohbette sesli mesaj
-- =============================================================================
-- Fotoğrafla aynı yapı (bkz. 20261110000100_chat_photos.sql):
-- * Sesli mesaj, `messages` tablosunda `kind = 'voice'` olan bir mesajdır;
--   dosya gizli `chat-voice` bucket'ında `<sohbet>/<rastgele>.<uzantı>` yolundadır.
-- * Kullanıcılar sesli mesajı ve dosyayı doğrudan YAZAMAZ. Tek yol `chat-voice`
--   Edge Function'ıdır: dosya türünü baytlardan belirler, boyutu sınırlar, sonra
--   `register_chat_voice` her kuralı yeniden denetleyip mesajı yazar.
-- * Kurallar (`private.chat_voice_status`, CLAUDE.md kural 5 ve 7):
--     - Özellik anahtarı `chat_voice_enabled` (varsayılan AÇIK; yönetim panelinden kapanır).
--     - Gönderen normal sohbette yazabiliyor olmalı (e-posta doğrulanmış, engel yok).
--     - Alıcının izni `voice_permission`: 'accepted_chats' (herkes, varsayılan),
--       'friends' (yalnızca arkadaşlarım) ya da 'nobody' (kimse).
--     - Sohbeti ALICI kabul etmiş olmalı. Mesaj istekleri ve anonim sohbetler
--       ayrı tablolardadır; oralara sesli mesaj hiç gidemez.
--     - Kişi başı 24 saatte en çok 100 sesli mesaj.
--     - En çok 1 dakika (süre 0,3–61 sn; dosya en çok 2 MB).
-- * Görme/dinleme: yalnızca sohbetin iki tarafı, kısa ömürlü imzalı bağlantıyla
--   (kural 3–4). Yönetici yalnızca şikâyet incelemesinde, sohbeti açtıktan
--   (işlem kaydı) sonraki 15 dakika içinde (kural 14).
-- * Saklama ve silme: yazılı mesaj ve fotoğrafla aynı. Mesaj hangi yoldan
--   silinirse silinsin (iki taraf da sohbeti silip 90 gün geçince, hesap
--   silindikten 90 gün sonra, test hesabı temizliği) dosyası silme kuyruğuna
--   girer; saatlik görev Edge Function'ı çağırıp dosyayı Storage'dan siler.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ayarlar
-- -----------------------------------------------------------------------------
insert into private.app_settings (key, value) values ('chat_voice_enabled', 'true'::jsonb)
on conflict (key) do nothing;

alter table public.profiles
  add column voice_permission text not null default 'accepted_chats'
    check (voice_permission in ('accepted_chats', 'friends', 'nobody'));
grant update (voice_permission) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Mesajlar: sesli mesaj sütunları
-- -----------------------------------------------------------------------------
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'photo', 'voice'));

alter table public.messages
  add column voice_path text unique,
  add column voice_duration_ms integer,
  -- Ses dalgası çizimi için 8–64 arası çubuk yüksekliği (0–100).
  add column voice_peaks smallint[];

-- Kullanıcıların yazabildiği sütunlar değişmedi: (id, conversation_id, body).
alter table public.messages drop constraint messages_content_check;
alter table public.messages add constraint messages_content_check check (
  (kind = 'text' and photo_path is null and voice_path is null
     and voice_duration_ms is null and voice_peaks is null
     and char_length(btrim(body)) between 1 and 2000)
  or
  (kind = 'photo' and body = '' and voice_path is null
     and voice_duration_ms is null and voice_peaks is null
     and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     and split_part(photo_path, '/', 1) = conversation_id::text)
  or
  (kind = 'voice' and body = '' and photo_path is null
     and voice_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|ogg|m4a)$'
     and split_part(voice_path, '/', 1) = conversation_id::text
     and voice_duration_ms is not null and voice_peaks is not null
     and voice_duration_ms between 300 and 61000
     and cardinality(voice_peaks) between 8 and 64
     and 0 <= all (voice_peaks) and 100 >= all (voice_peaks))
);

-- Hız sınırı sayacı (sesli mesaj silinse de sayım değişmesin diye ayrı).
create table private.chat_voice_uploads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index chat_voice_uploads_user_idx on private.chat_voice_uploads (user_id, created_at desc);
alter table private.chat_voice_uploads enable row level security;
revoke all on private.chat_voice_uploads from public, anon, authenticated;

-- Storage'dan silinecek ses dosyaları.
create table private.chat_voice_deletions (
  storage_path text primary key,
  queued_at timestamptz not null default now()
);
alter table private.chat_voice_deletions enable row level security;
revoke all on private.chat_voice_deletions from public, anon, authenticated;

create or replace function private.messages_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'photo' and old.photo_path is not null then
    insert into private.chat_photo_deletions (storage_path) values (old.photo_path)
    on conflict (storage_path) do nothing;
  elsif old.kind = 'voice' and old.voice_path is not null then
    insert into private.chat_voice_deletions (storage_path) values (old.voice_path)
    on conflict (storage_path) do nothing;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Kural: 'ok' ya da neden gönderilemediği
-- -----------------------------------------------------------------------------
create or replace function private.chat_voice_status(p_conversation uuid, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  v_other uuid;
  v_permission text;
begin
  if not private.setting_bool('chat_voice_enabled', true) then
    return 'disabled';
  end if;
  select * into c from public.conversations where id = p_conversation;
  if not found or p_user is null or p_user not in (c.user_a, c.user_b) then
    return 'not_found';
  end if;
  if not private.can_send_message_as(p_conversation, p_user) then
    return 'not_allowed';
  end if;
  v_other := case when c.user_a = p_user then c.user_b else c.user_a end;
  select voice_permission into v_permission from public.profiles where id = v_other;
  if v_permission = 'nobody' then
    return 'recipient_off';
  end if;
  if v_permission = 'friends' then
    -- Arkadaşlık, alıcının bu kişiyi kabul ettiği anlamına gelir.
    if not private.are_friends(p_user, v_other) then
      return 'friends_only';
    end if;
  elsif not private.chat_accepted_by(p_conversation, v_other) then
    return 'not_accepted';
  end if;
  if (select count(*) from private.chat_voice_uploads
      where user_id = p_user and created_at > now() - interval '24 hours') >= 100 then
    return 'rate_limited';
  end if;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- Uygulamanın kullandığı fonksiyonlar
-- -----------------------------------------------------------------------------
create or replace function public.chat_voice_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting_bool('chat_voice_enabled', true)
$$;

-- Sohbet başlığı: `voice` = mikrofon düğmesinin durumu.
create or replace function public.get_conversation(p_conversation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'other', private.profile_card(o.other_id, auth.uid()),
    'can_send', private.can_send_message(c.id),
    'photo', private.chat_photo_status(c.id, auth.uid()),
    'voice', private.chat_voice_status(c.id, auth.uid()),
    'other_read_at', case
      when me.show_read_receipts and them.show_read_receipts
        then case when c.user_a = o.other_id then c.a_last_read_at else c.b_last_read_at end
    end
  )
  from public.conversations c
  cross join lateral (
    select case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id
  ) o
  join public.profiles me on me.id = auth.uid()
  join public.profiles them on them.id = o.other_id
  where c.id = p_conversation
    and auth.uid() in (c.user_a, c.user_b)
    and not private.is_blocked_between(c.user_a, c.user_b)
    and not private.anon_blocked(o.other_id, auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- Edge Function'ın (service_role) kullandığı fonksiyonlar
-- -----------------------------------------------------------------------------
create or replace function public.chat_voice_upload_check(p_user uuid, p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.chat_voice_status(p_conversation, p_user)
$$;

-- Dosya yüklendikten sonra: kurallar yeniden denetlenir, mesaj yazılır.
-- Aynı kimlikle tekrar deneme var olan mesajı döndürür (`duplicate = true`).
create or replace function public.register_chat_voice(
  p_user uuid, p_conversation uuid, p_id uuid, p_path text, p_duration_ms integer, p_peaks smallint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row public.messages%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_voice:' || coalesce(p_user::text, ''), 0));

  if p_id is not null then
    select * into v_row from public.messages where id = p_id;
    if found then
      if v_row.sender_id = p_user and v_row.conversation_id = p_conversation and v_row.kind = 'voice' then
        return jsonb_build_object('duplicate', true, 'message', private.voice_message_json(v_row));
      end if;
      raise exception 'duplicate_id' using errcode = '23505';
    end if;
  end if;

  v_status := private.chat_voice_status(p_conversation, p_user);
  if v_status <> 'ok' then
    raise exception '%', v_status using errcode = case when v_status = 'rate_limited' then 'P0001' else '42501' end;
  end if;

  insert into private.chat_voice_uploads (user_id) values (p_user);
  insert into public.messages (id, conversation_id, sender_id, body, kind, voice_path, voice_duration_ms, voice_peaks)
  values (coalesce(p_id, gen_random_uuid()), p_conversation, p_user, '', 'voice', p_path, p_duration_ms, p_peaks)
  returning * into v_row;

  return jsonb_build_object('duplicate', false, 'message', private.voice_message_json(v_row));
end;
$$;

create or replace function private.voice_message_json(m public.messages)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id,
    'body', m.body, 'kind', m.kind, 'voice_path', m.voice_path,
    'voice_duration_ms', m.voice_duration_ms, 'voice_peaks', to_jsonb(m.voice_peaks),
    'created_at', m.created_at)
$$;

-- Silme kuyruğu
create or replace function public.chat_voice_deletions_due(p_limit integer default 500)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(storage_path), '{}')
  from (
    select storage_path from private.chat_voice_deletions
    order by queued_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ) d
$$;

create or replace function public.mark_chat_voice_deletions_done(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  delete from private.chat_voice_deletions where storage_path = any(coalesce(p_paths, '{}'));
  get diagnostics v = row_count;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yönetim: özellik anahtarı ve şikâyet incelemesinde sesli mesajlar
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_audit('settings.view');
  return jsonb_build_object(
    'photo_auto_approve', private.setting_bool('photo_auto_approve', true),
    'chat_photos_enabled', private.setting_bool('chat_photos_enabled', false),
    'chat_voice_enabled', private.setting_bool('chat_voice_enabled', true)
  );
end;
$$;

create or replace function public.admin_set_chat_voice(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_audit('settings.chat_voice', 'setting', 'chat_voice_enabled',
                              jsonb_build_object('enabled', coalesce(p_enabled, false)));
  insert into private.app_settings (key, value, updated_at)
  values ('chat_voice_enabled', to_jsonb(coalesce(p_enabled, false)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Şikâyet ayrıntısı: sesli mesajın yolu ve süresi eklendi.
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
    select coalesce(jsonb_agg(jsonb_build_object('sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at,
                                                 'kind', m.kind, 'photo_path', m.photo_path,
                                                 'voice_path', m.voice_path, 'voice_duration_ms', m.voice_duration_ms)
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

-- -----------------------------------------------------------------------------
-- Storage: gizli bucket ve okuma kuralı
-- -----------------------------------------------------------------------------
create or replace function private.can_view_chat_voice(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.voice_path = p_name
      and m.kind = 'voice'
      and (
        (c.user_a = auth.uid() and m.created_at > coalesce(c.a_cleared_at, '-infinity'::timestamptz))
        or (c.user_b = auth.uid() and m.created_at > coalesce(c.b_cleared_at, '-infinity'::timestamptz))
        or (
          private.is_admin(auth.uid())
          and exists (
            select 1 from private.admin_audit_log l
            where l.admin_id = auth.uid()
              and l.action = 'conversation.view'
              and l.target_id = c.id::text
              and l.created_at > now() - interval '15 minutes'
          )
        )
      )
  )
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-voice', 'chat-voice', false, 2097152, array['audio/webm', 'audio/ogg', 'audio/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yalnızca OKUMA (imzalı bağlantı için). Yazma/silme yalnızca Edge Function'da.
create policy "chat-voice: sohbetin tarafları okur"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-voice' and private.can_view_chat_voice(name));

-- -----------------------------------------------------------------------------
-- Saatlik görev: sayaç temizliği ve silme kuyruğu için Edge Function çağrısı
-- -----------------------------------------------------------------------------
create or replace function private.chat_voice_hourly()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_pending integer;
  v_called boolean := false;
begin
  delete from private.chat_voice_uploads where created_at < now() - interval '2 days';
  select count(*) into v_pending from private.chat_voice_deletions;

  select value #>> '{}' into v_url from private.app_settings where key = 'functions_base_url';
  select value #>> '{}' into v_token from private.app_settings where key = 'cron_token';
  if v_pending > 0 and v_url is not null and v_token is not null and to_regnamespace('net') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url || '/functions/v1/chat-voice/purge',
            '{}'::jsonb,
            jsonb_build_object('x-sohby-cron', v_token, 'Content-Type', 'application/json');
    v_called := true;
  end if;
  return jsonb_build_object('pending', v_pending, 'purge_requested', v_called);
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sohby-chat-voice', '57 * * * *', 'select private.chat_voice_hourly()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.messages_after_delete() from public, anon, authenticated;
revoke execute on function private.chat_voice_status(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.voice_message_json(public.messages) from public, anon, authenticated;
revoke execute on function private.can_view_chat_voice(text) from public, anon, authenticated;
revoke execute on function private.chat_voice_hourly() from public, anon, authenticated;
revoke execute on function public.chat_voice_enabled() from public, anon, authenticated;
revoke execute on function public.chat_voice_upload_check(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.register_chat_voice(uuid, uuid, uuid, text, integer, smallint[]) from public, anon, authenticated;
revoke execute on function public.chat_voice_deletions_due(integer) from public, anon, authenticated;
revoke execute on function public.mark_chat_voice_deletions_done(text[]) from public, anon, authenticated;
revoke execute on function public.admin_set_chat_voice(boolean) from public, anon, authenticated;

-- Storage RLS politikası çağırır (kendi içinde yetkiyi denetler).
grant execute on function private.can_view_chat_voice(text) to authenticated;
grant execute on function public.chat_voice_enabled() to authenticated;
-- Yönetim fonksiyonu yönetici rolünü kendisi denetler (admin_audit).
grant execute on function public.admin_set_chat_voice(boolean) to authenticated;
grant execute on function public.chat_voice_upload_check(uuid, uuid) to service_role;
grant execute on function public.register_chat_voice(uuid, uuid, uuid, text, integer, smallint[]) to service_role;
grant execute on function public.chat_voice_deletions_due(integer) to service_role;
grant execute on function public.mark_chat_voice_deletions_done(text[]) to service_role;
