-- =============================================================================
-- Sohby — Bildirimler (uygulama içi bildirim paneli)
-- =============================================================================
-- * Bildirimleri veritabanı tetikleyicileri yazar; kullanıcılar bildirim
--   yazamaz, yalnızca kendi bildirimlerini okur ve "okundu" yapar (kural 1).
-- * Türler:
--     friend_request            — biri sana arkadaşlık isteği gönderdi
--     friend_accepted           — arkadaşlık isteğin kabul edildi
--     message_request           — yeni mesaj isteği
--     message_request_accepted  — mesaj isteğin kabul edildi (sohbet açıldı)
--     anon_request              — yeni anonim mesaj (gönderen YAZILMAZ — kural 10)
--     student_approved / student_rejected — kampüs öğrenci kartı incelemesi
--     photo_approved / photo_rejected     — profil fotoğrafı incelemesi
-- * Reddedilen istekler gönderene bildirilmez (gönderen reddedildiğini öğrenmez).
-- * Engellenen ya da hesabı kapanan kişiden gelen bildirimler listelenmez
--   (kural 6); ilgili istek geri çekilince bildirimi de silinir.
-- * Yeni mesajlar bildirim üretmez (Sohbetler rozeti onları zaten sayar).
-- * 90 günden eski bildirimler günlük temizlikte silinir.
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'friend_request', 'friend_accepted',
    'message_request', 'message_request_accepted',
    'anon_request',
    'student_approved', 'student_rejected',
    'photo_approved', 'photo_rejected'
  )),
  actor_id uuid references public.profiles (id) on delete cascade,
  friend_request_id uuid references public.friend_requests (id) on delete cascade,
  message_request_id uuid references public.message_requests (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  anon_conversation_id uuid references public.anon_conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- Anonim bildirimde gönderen asla yazılmaz.
  constraint notifications_anon_no_actor check (type <> 'anon_request' or actor_id is null)
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_actor_idx on public.notifications (actor_id);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;

-- Okuma: yalnızca kendi bildirimleri (Realtime aboneliği için de gerekli).
-- Yazma/güncelleme yalnızca RPC ve tetikleyicilerle.
grant select on public.notifications to authenticated;
create policy "notifications: sahibi okur"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tetikleyiciler
-- -----------------------------------------------------------------------------

-- Arkadaşlık istekleri
create or replace function private.friend_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      insert into public.notifications (user_id, type, actor_id, friend_request_id)
      values (new.recipient_id, 'friend_request', new.sender_id, new.id);
    end if;
    return null;
  end if;

  if old.status = 'pending' and new.status = 'accepted' then
    insert into public.notifications (user_id, type, actor_id, friend_request_id)
    values (new.sender_id, 'friend_accepted', new.recipient_id, new.id);
  elsif old.status = 'pending' and new.status = 'cancelled' then
    -- Geri çekilen istek alıcının listesinden kalkar.
    delete from public.notifications
     where friend_request_id = new.id and type = 'friend_request';
  end if;
  return null;
end;
$$;

create trigger friend_requests_notify
  after insert or update of status on public.friend_requests
  for each row execute function private.friend_requests_notify();

-- Mesaj istekleri
create or replace function private.message_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      insert into public.notifications (user_id, type, actor_id, message_request_id)
      values (new.recipient_id, 'message_request', new.sender_id, new.id);
    end if;
    return null;
  end if;

  if old.status = 'pending' and new.status = 'accepted' then
    insert into public.notifications (user_id, type, actor_id, message_request_id, conversation_id)
    values (new.sender_id, 'message_request_accepted', new.recipient_id, new.id, new.conversation_id);
  end if;
  return null;
end;
$$;

create trigger message_requests_notify
  after insert or update of status on public.message_requests
  for each row execute function private.message_requests_notify();

-- Anonim sohbet istekleri: gönderen yazılmaz (kural 10).
create or replace function private.anon_conversations_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (user_id, type, anon_conversation_id)
    values (new.recipient_id, 'anon_request', new.id);
  end if;
  return null;
end;
$$;

create trigger anon_conversations_notify
  after insert on public.anon_conversations
  for each row execute function private.anon_conversations_notify();

-- Kampüs: öğrenci kartı incelendi.
create or replace function private.student_documents_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notifications (user_id, type)
    values (new.user_id, case when new.status = 'approved' then 'student_approved' else 'student_rejected' end);
  end if;
  return null;
end;
$$;

create trigger student_documents_notify
  after update of status on private.student_documents
  for each row execute function private.student_documents_notify();

-- Profil fotoğrafı yönetici tarafından incelendi (otomatik onay bildirim üretmez).
create or replace function private.profile_photos_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notifications (user_id, type)
    values (new.user_id, case when new.status = 'approved' then 'photo_approved' else 'photo_rejected' end);
  end if;
  return null;
end;
$$;

create trigger profile_photos_notify
  after update of status on public.profile_photos
  for each row execute function private.profile_photos_notify();

-- -----------------------------------------------------------------------------
-- Görünür bildirimler
-- -----------------------------------------------------------------------------
-- Gönderen engelliyse ya da hesabı etkin değilse bildirim gösterilmez. Reddedilen
-- istekler listeden kalkar (kabul edilenler "artık arkadaşsınız" olarak kalır).
create or replace function private.visible_notifications(p_user uuid)
returns setof public.notifications
language sql
stable
security definer
set search_path = ''
as $$
  select n.*
  from public.notifications n
  left join public.friend_requests fr on fr.id = n.friend_request_id
  left join public.message_requests mr on mr.id = n.message_request_id
  left join public.anon_conversations ac on ac.id = n.anon_conversation_id
  where n.user_id = p_user
    and (
      n.actor_id is null
      or (
        private.is_active_user(n.actor_id)
        and not private.is_blocked_between(p_user, n.actor_id)
        and not private.anon_blocked(n.actor_id, p_user)
      )
    )
    and (n.type <> 'friend_request' or fr.status in ('pending', 'accepted'))
    and (n.type <> 'message_request' or mr.status in ('pending', 'accepted'))
    and (
      n.type <> 'anon_request'
      or (
        ac.status in ('pending', 'active', 'revealed')
        and not private.is_blocked_between(private.anon_sender_of(ac.id), ac.recipient_id)
        and not private.anon_blocked(ac.recipient_id, private.anon_sender_of(ac.id))
      )
    )
$$;

-- Bildirim listesi (en yeniler önce). Her öğede bağlı isteğin güncel durumu da
-- döner: arayüz "Kabul et / Reddet" düğmelerini yalnızca bekleyen istekte gösterir.
create or replace function public.get_notifications(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  from (
    select
      n.created_at,
      jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'created_at', n.created_at,
        'read', n.read_at is not null,
        'actor', case when n.actor_id is not null then private.friend_card(n.actor_id) end,
        'friend_request_id', n.friend_request_id,
        'friend_request_status', fr.status,
        'friends', case when n.actor_id is not null then private.are_friends(n.user_id, n.actor_id) else false end,
        'message_request_id', n.message_request_id,
        'message_request_status', mr.status,
        'conversation_id', coalesce(n.conversation_id, mr.conversation_id),
        'anon_conversation_id', n.anon_conversation_id,
        'anon_status', ac.status
      ) as item
    from private.visible_notifications(auth.uid()) n
    left join public.friend_requests fr on fr.id = n.friend_request_id
    left join public.message_requests mr on mr.id = n.message_request_id
    left join public.anon_conversations ac on ac.id = n.anon_conversation_id
    order by n.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) x
$$;

-- Hepsini okundu yap (bildirim paneli açılınca).
create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null
$$;

-- Rozetler: okunmamış bildirim sayısı eklendi (diğer sayılar değişmedi).
create or replace function public.get_badge_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread_messages', (
      select count(*)
      from public.conversations c
      join public.messages m on m.conversation_id = c.id
      where auth.uid() in (c.user_a, c.user_b)
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(
          case when c.user_a = auth.uid() then c.a_last_read_at else c.b_last_read_at end,
          '-infinity'::timestamptz)
        and not private.is_blocked_between(c.user_a, c.user_b)
    ) + (
      select coalesce(sum((x ->> 'unread_count')::int), 0)
      from jsonb_array_elements(public.get_anon_conversations()) x
      where x ->> 'status' = 'active'
    ),
    'pending_requests', (
      select count(*)
      from public.message_requests r
      where r.recipient_id = auth.uid() and r.status = 'pending'
        and private.is_active_user(r.sender_id)
        and not private.is_blocked_between(r.recipient_id, r.sender_id)
    ) + (
      select count(*) from public.anon_conversations c
      where c.recipient_id = auth.uid() and c.status = 'pending'
        and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
        and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id))
    ),
    'unread_notifications', (
      select count(*) from private.visible_notifications(auth.uid()) n
      where n.read_at is null
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- Saklama: 90 günden eski bildirimler silinir (günlük görev).
-- -----------------------------------------------------------------------------
create or replace function private.purge_old_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.notifications where created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'underage', private.purge_underage_accounts(),
    'deleted_accounts', private.purge_deleted_accounts(),
    'hidden_messages', private.purge_hidden_messages(),
    'notifications', private.purge_old_notifications()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.friend_requests_notify() from public, anon, authenticated;
revoke execute on function private.message_requests_notify() from public, anon, authenticated;
revoke execute on function private.anon_conversations_notify() from public, anon, authenticated;
revoke execute on function private.student_documents_notify() from public, anon, authenticated;
revoke execute on function private.profile_photos_notify() from public, anon, authenticated;
revoke execute on function private.visible_notifications(uuid) from public, anon, authenticated;
revoke execute on function private.purge_old_notifications() from public, anon, authenticated;
revoke execute on function private.purge_expired_data() from public, anon, authenticated;

revoke execute on function public.get_notifications(integer) from public, anon;
revoke execute on function public.mark_notifications_read() from public, anon;
revoke execute on function public.get_badge_counts() from public, anon;
grant execute on function public.get_notifications(integer) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.get_badge_counts() to authenticated;
