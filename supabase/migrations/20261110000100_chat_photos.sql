-- =============================================================================
-- Sohby — 18: Sohbette fotoğraf (basit)
-- =============================================================================
-- * Fotoğraf, `messages` tablosunda `kind = 'photo'` olan bir mesajdır; dosya
--   gizli `chat-photos` bucket'ında `<sohbet>/<rastgele>.<uzantı>` yolundadır.
-- * Kullanıcılar fotoğraf mesajı ve dosya YAZAMAZ (sütun yetkisi + bucket'ta
--   yazma politikası yok). Tek yol `chat-photos` Edge Function'ıdır: dosya
--   türünü baytlardan belirler, EXIF/GPS dahil üst verileri siler (kural 12),
--   sonra `register_chat_photo` her kuralı yeniden denetleyip mesajı yazar.
-- * Kurallar (`private.chat_photo_status`):
--     - Özellik anahtarı (`chat_photos_enabled`, varsayılan KAPALI) açık olmalı.
--     - Gönderen normal sohbette yazabiliyor olmalı (e-posta doğrulanmış,
--       hesaplar etkin, engel yok — `can_send_message` ile aynı kurallar).
--     - Alıcının izni: `photo_permission` = 'accepted_chats' (varsayılan) ya
--       da 'nobody' (kural 5).
--     - Sohbeti ALICI kabul etmiş olmalı: sohbeti o başlatmış, isteği kabul
--       etmiş, anonim sohbeti kabul edip kimlik açılmış ya da en az bir kez
--       yazmış. Mesaj istekleri ve anonim sohbetler ayrı tablolardadır;
--       oralara fotoğraf hiç gidemez (kural 7).
--     - Kişi başı 24 saatte en çok 50 fotoğraf.
-- * Görme: yalnızca sohbetin iki tarafı (kendi görünümünden sildiği eski
--   fotoğraflar hariç) kısa ömürlü imzalı bağlantıyla (kural 3–4). Yönetici,
--   yalnızca şikâyet incelemesinde sohbeti açtıktan (işlem kaydı) sonraki
--   15 dakika içinde (kural 14).
-- * Silme: fotoğraf mesajı hangi yoldan silinirse silinsin (90 gün kuralı,
--   hesap silme, test hesabı temizliği) dosyası silme kuyruğuna girer; saatlik
--   görev Edge Function'ı çağırıp dosyaları Storage'dan siler.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ayarlar
-- -----------------------------------------------------------------------------
insert into private.app_settings (key, value) values ('chat_photos_enabled', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.profiles
  add column photo_permission text not null default 'accepted_chats'
    check (photo_permission in ('accepted_chats', 'nobody'));
grant update (photo_permission) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Mesajlar: tür ve fotoğraf yolu
-- -----------------------------------------------------------------------------
alter table public.messages
  add column kind text not null default 'text' check (kind in ('text', 'photo')),
  add column photo_path text unique;

-- Kullanıcıların yazabildiği sütunlar değişmedi: (id, conversation_id, body).
-- `kind` ve `photo_path` yalnızca register_chat_photo ile yazılır.
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_content_check check (
  (kind = 'text' and photo_path is null
     and char_length(btrim(body)) between 1 and 2000)
  or
  (kind = 'photo' and body = ''
     and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     and split_part(photo_path, '/', 1) = conversation_id::text)
);

-- Hız sınırı sayacı (fotoğraf mesajı silinse de sayım değişmesin diye ayrı).
create table private.chat_photo_uploads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index chat_photo_uploads_user_idx on private.chat_photo_uploads (user_id, created_at desc);
alter table private.chat_photo_uploads enable row level security;
revoke all on private.chat_photo_uploads from public, anon, authenticated;

-- Storage'dan silinecek dosyalar (SQL, Storage dosyasını doğrudan silemez).
create table private.chat_photo_deletions (
  storage_path text primary key,
  queued_at timestamptz not null default now()
);
alter table private.chat_photo_deletions enable row level security;
revoke all on private.chat_photo_deletions from public, anon, authenticated;

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
  end if;
  return null;
end;
$$;

create trigger messages_after_delete
  after delete on public.messages
  for each row execute function private.messages_after_delete();

-- -----------------------------------------------------------------------------
-- Yazabilme kuralı: belirli bir kullanıcı için (Edge Function auth.uid()'siz çalışır)
-- -----------------------------------------------------------------------------
create or replace function private.can_send_message_as(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
    from public.conversations c
    where c.id = p_conversation
      and p_user in (c.user_a, c.user_b)
      and private.is_email_verified(p_user)
      and private.is_active_user(c.user_a)
      and private.is_active_user(c.user_b)
      and not private.is_blocked_between(c.user_a, c.user_b)
      -- Karşı taraf beni anonim sohbetten engellediyse yazamam (tersi serbest).
      and not private.anon_blocked(case when c.user_a = p_user then c.user_b else c.user_a end, p_user)
  )
$$;

-- Var olan kural aynen korunur; artık tek bir yerde tanımlı.
create or replace function private.can_send_message(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_send_message_as(p_conversation, auth.uid())
$$;

-- Alıcı bu sohbeti kabul etmiş mi?
create or replace function private.chat_accepted_by(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and p_user in (c.user_a, c.user_b)
      and (
        c.initiated_by = p_user
        or exists (select 1 from public.messages m
                   where m.conversation_id = c.id and m.sender_id = p_user)
        or exists (select 1 from public.message_requests r
                   where r.conversation_id = c.id and r.recipient_id = p_user and r.status = 'accepted')
        or exists (select 1 from public.anon_conversations a
                   where a.revealed_conversation_id = c.id)
      )
  )
$$;

-- 'ok' ya da neden gönderilemediği.
create or replace function private.chat_photo_status(p_conversation uuid, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  v_other uuid;
begin
  if not private.setting_bool('chat_photos_enabled', false) then
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
  if (select photo_permission from public.profiles where id = v_other) = 'nobody' then
    return 'recipient_off';
  end if;
  if not private.chat_accepted_by(p_conversation, v_other) then
    return 'not_accepted';
  end if;
  if (select count(*) from private.chat_photo_uploads
      where user_id = p_user and created_at > now() - interval '24 hours') >= 50 then
    return 'rate_limited';
  end if;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- Uygulamanın kullandığı fonksiyonlar
-- -----------------------------------------------------------------------------
-- Özellik açık mı? (Ayarlar sayfası seçeneği yalnızca açıkken gösterir.)
create or replace function public.chat_photos_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting_bool('chat_photos_enabled', false)
$$;

-- Sohbet başlığı: `photo` = fotoğraf düğmesinin durumu.
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

-- Sohbet listesi: son mesajın türü de döner (fotoğrafta metin boş).
create or replace function public.get_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select
      c.id,
      c.last_message_at,
      case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id,
      case when c.user_a = auth.uid() then c.a_last_read_at else c.b_last_read_at end as my_last_read,
      coalesce(case when c.user_a = auth.uid() then c.a_cleared_at else c.b_cleared_at end, '-infinity'::timestamptz) as my_cleared
    from public.conversations c
    where auth.uid() in (c.user_a, c.user_b)
      -- Kendi görünümünden silinmiş sohbet, yeni mesaj gelene kadar listelenmez.
      and coalesce(c.last_message_at, c.created_at) > coalesce(case when c.user_a = auth.uid() then c.a_cleared_at else c.b_cleared_at end, '-infinity'::timestamptz)
  )
  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]'::jsonb)
  from (
    select
      coalesce(m.last_message_at, '-infinity'::timestamptz) as sort_at,
      jsonb_build_object(
        'id', m.id,
        'other', private.profile_card(m.other_id, auth.uid()),
        'last_message', (
          select jsonb_build_object(
            'body', left(lm.body, 140),
            'kind', lm.kind,
            'created_at', lm.created_at,
            'from_me', lm.sender_id = auth.uid()
          )
          from public.messages lm
          where lm.conversation_id = m.id and lm.created_at > m.my_cleared
          order by lm.created_at desc
          limit 1
        ),
        'unread_count', (
          select count(*)
          from public.messages um
          where um.conversation_id = m.id
            and um.sender_id <> auth.uid()
            and um.created_at > coalesce(m.my_last_read, '-infinity'::timestamptz)
            and um.created_at > m.my_cleared
        )
      ) as row_data
    from mine m
    where not private.is_blocked_between(auth.uid(), m.other_id)
      and not private.anon_blocked(m.other_id, auth.uid())
  ) rows
$$;

-- -----------------------------------------------------------------------------
-- Edge Function'ın (service_role) kullandığı fonksiyonlar
-- -----------------------------------------------------------------------------
-- Dosyayı yüklemeden önce hızlı denetim (gereksiz yüklemeyi önler).
create or replace function public.chat_photo_upload_check(p_user uuid, p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.chat_photo_status(p_conversation, p_user)
$$;

-- Dosya yüklendikten sonra: kurallar yeniden denetlenir, mesaj yazılır.
-- Aynı kimlikle tekrar deneme (yanıt yolda kaybolduysa) var olan mesajı döndürür
-- ve `duplicate = true` der; Edge Function yeni yüklenen dosyayı siler.
create or replace function public.register_chat_photo(p_user uuid, p_conversation uuid, p_id uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row public.messages%rowtype;
begin
  -- Aynı kişinin eşzamanlı yüklemeleri sırayla: hız sınırı aşılamaz.
  perform pg_advisory_xact_lock(hashtextextended('chat_photo:' || coalesce(p_user::text, ''), 0));

  if p_id is not null then
    select * into v_row from public.messages where id = p_id;
    if found then
      if v_row.sender_id = p_user and v_row.conversation_id = p_conversation and v_row.kind = 'photo' then
        return jsonb_build_object('duplicate', true, 'message', jsonb_build_object(
          'id', v_row.id, 'conversation_id', v_row.conversation_id, 'sender_id', v_row.sender_id,
          'body', v_row.body, 'kind', v_row.kind, 'photo_path', v_row.photo_path, 'created_at', v_row.created_at));
      end if;
      raise exception 'duplicate_id' using errcode = '23505';
    end if;
  end if;

  v_status := private.chat_photo_status(p_conversation, p_user);
  if v_status <> 'ok' then
    raise exception '%', v_status using errcode = case when v_status = 'rate_limited' then 'P0001' else '42501' end;
  end if;

  insert into private.chat_photo_uploads (user_id) values (p_user);
  insert into public.messages (id, conversation_id, sender_id, body, kind, photo_path)
  values (coalesce(p_id, gen_random_uuid()), p_conversation, p_user, '', 'photo', p_path)
  returning * into v_row;

  return jsonb_build_object('duplicate', false, 'message', jsonb_build_object(
    'id', v_row.id, 'conversation_id', v_row.conversation_id, 'sender_id', v_row.sender_id,
    'body', v_row.body, 'kind', v_row.kind, 'photo_path', v_row.photo_path, 'created_at', v_row.created_at));
end;
$$;

-- Silme kuyruğu
create or replace function public.chat_photo_deletions_due(p_limit integer default 500)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(storage_path), '{}')
  from (
    select storage_path from private.chat_photo_deletions
    order by queued_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ) d
$$;

create or replace function public.mark_chat_photo_deletions_done(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  delete from private.chat_photo_deletions where storage_path = any(coalesce(p_paths, '{}'));
  get diagnostics v = row_count;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yönetim: özellik anahtarı ve şikâyet incelemesinde fotoğraflar
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
    'chat_photos_enabled', private.setting_bool('chat_photos_enabled', false)
  );
end;
$$;

create or replace function public.admin_set_chat_photos(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_audit('settings.chat_photos', 'setting', 'chat_photos_enabled',
                              jsonb_build_object('enabled', coalesce(p_enabled, false)));
  insert into private.app_settings (key, value, updated_at)
  values ('chat_photos_enabled', to_jsonb(coalesce(p_enabled, false)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Şikâyet ayrıntısı: normal sohbet mesajlarına tür ve fotoğraf yolu eklendi.
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
                                                 'kind', m.kind, 'photo_path', m.photo_path)
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
create or replace function private.can_view_chat_photo(p_name text)
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
    where m.photo_path = p_name
      and m.kind = 'photo'
      and (
        -- Sohbetin tarafları (kendi görünümünden sildiği eski mesajlar hariç).
        (c.user_a = auth.uid() and m.created_at > coalesce(c.a_cleared_at, '-infinity'::timestamptz))
        or (c.user_b = auth.uid() and m.created_at > coalesce(c.b_cleared_at, '-infinity'::timestamptz))
        -- Yönetici: yalnızca bu sohbeti şikâyet incelemesinde son 15 dakikada açtıysa.
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
values ('chat-photos', 'chat-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yalnızca OKUMA (imzalı bağlantı üretmek için). Yazma/silme politikası yok:
-- yalnızca Edge Function (service_role) yazar ve siler.
create policy "chat-photos: sohbetin tarafları okur"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and private.can_view_chat_photo(name));

-- -----------------------------------------------------------------------------
-- Saatlik görev: sayaç temizliği ve silme kuyruğu için Edge Function çağrısı
-- -----------------------------------------------------------------------------
create or replace function private.chat_photos_hourly()
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
  delete from private.chat_photo_uploads where created_at < now() - interval '2 days';
  select count(*) into v_pending from private.chat_photo_deletions;

  select value #>> '{}' into v_url from private.app_settings where key = 'functions_base_url';
  select value #>> '{}' into v_token from private.app_settings where key = 'cron_token';
  -- pg_net yalnızca Supabase'te var; yerel testte çağrı atlanır.
  if v_pending > 0 and v_url is not null and v_token is not null and to_regnamespace('net') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url || '/functions/v1/chat-photos/purge',
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
    perform cron.schedule('sohby-chat-photos', '53 * * * *', 'select private.chat_photos_hourly()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.messages_after_delete() from public, anon, authenticated;
revoke execute on function private.can_send_message_as(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_accepted_by(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_photo_status(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_view_chat_photo(text) from public, anon, authenticated;
revoke execute on function private.chat_photos_hourly() from public, anon, authenticated;
revoke execute on function public.chat_photos_enabled() from public, anon, authenticated;
revoke execute on function public.chat_photo_upload_check(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.register_chat_photo(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.chat_photo_deletions_due(integer) from public, anon, authenticated;
revoke execute on function public.mark_chat_photo_deletions_done(text[]) from public, anon, authenticated;
revoke execute on function public.admin_set_chat_photos(boolean) from public, anon, authenticated;

-- Storage RLS politikası çağırır (kendi içinde yetkiyi denetler).
grant execute on function private.can_view_chat_photo(text) to authenticated;
grant execute on function public.chat_photos_enabled() to authenticated;
-- Yönetim fonksiyonları yönetici rolünü kendisi denetler.
grant execute on function public.admin_set_chat_photos(boolean) to authenticated;
grant execute on function public.chat_photo_upload_check(uuid, uuid) to service_role;
grant execute on function public.register_chat_photo(uuid, uuid, uuid, text) to service_role;
grant execute on function public.chat_photo_deletions_due(integer) to service_role;
grant execute on function public.mark_chat_photo_deletions_done(text[]) to service_role;
