-- =============================================================================
-- Sohby — 2/3: Sohbetler, mesajlar, mesaj istekleri
-- =============================================================================
-- * Sohbet her zaman iki kişiliktir (user_a < user_b, çift başına tek sohbet).
-- * Bir sohbetin mesajlarını yalnızca o iki kişi görebilir.
-- * Sohbet ve istek oluşturma yalnızca RPC'lerle yapılır (doğrudan INSERT yok):
--   alıcının "kimler mesaj atabilir" ayarı, engeller, flört kuralı ve hız
--   sınırları tek yerde uygulanır.
-- * İstek reddedildiğinde gönderen bunu öğrenmez; aynı kişiye tekrar istek
--   gönderemez (sessizce yok sayılır).
-- * Engelleme 3. migration'da; buradaki fonksiyonlar private.is_blocked_between
--   kullanır (önce tanımlanması için engelleme tablosu burada oluşturulur).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- blocks (RLS ve RPC'leri 3. migration'da)
-- -----------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  a_last_read_at timestamptz,
  b_last_read_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversations_ordered check (user_a < user_b),
  constraint conversations_pair_unique unique (user_a, user_b)
);

create index conversations_user_b_idx on public.conversations (user_b);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_created_idx on public.messages (sender_id, created_at desc);

-- -----------------------------------------------------------------------------
-- message_requests
-- -----------------------------------------------------------------------------
create table public.message_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  is_flirt boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);

create unique index message_requests_one_pending_per_pair
  on public.message_requests (sender_id, recipient_id)
  where status = 'pending';
create index message_requests_recipient_idx
  on public.message_requests (recipient_id, status, created_at desc);
create index message_requests_sender_idx
  on public.message_requests (sender_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Yardımcılar
-- -----------------------------------------------------------------------------
create or replace function private.conversation_between(p_a uuid, p_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.conversations
  where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b)
$$;

-- RLS INSERT politikasında kullanılır: kullanıcı bu sohbete yazabilir mi?
create or replace function private.can_send_message(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation
      and auth.uid() in (c.user_a, c.user_b)
      and private.is_active_user(c.user_a)
      and private.is_active_user(c.user_b)
      and not private.is_blocked_between(c.user_a, c.user_b)
  )
$$;

grant execute on function private.can_send_message(uuid) to authenticated;

-- Hedef kişi, izleyene görünür mü? (Keşfet'te görünmeyi kapatan kişiyi
-- yalnızca ona daha önce yazmış/ondan istek almış kişiler görebilir.)
create or replace function private.profile_visible_to(p_target uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target = p_viewer
      or (
        private.is_active_user(p_target)
        and not private.is_blocked_between(p_target, p_viewer)
        and (
          exists (select 1 from public.profiles where id = p_target and show_in_discover)
          or private.conversation_between(p_target, p_viewer) is not null
          or exists (
            select 1 from public.message_requests
            where sender_id = p_target and recipient_id = p_viewer
          )
        )
      )
$$;

-- İzleyenin hedefe nasıl yazabileceği: 'conversation' (sohbet zaten var),
-- 'direct', 'request' ya da 'not_allowed'.
create or replace function private.message_mode(p_target uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_target = p_viewer then 'not_allowed'
    when private.conversation_between(p_target, p_viewer) is not null then 'conversation'
    when p.message_policy = 'everyone' then 'direct'
    when p.message_policy = 'request_first' then 'request'
    when p.message_policy = 'common_hobby'
      and private.common_hobby_count(p_target, p_viewer) > 0 then 'request'
    else 'not_allowed'
  end
  from public.profiles p
  where p.id = p_target
$$;

create or replace function private.ensure_conversation(p_a uuid, p_b uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.conversations (user_a, user_b)
  values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict (user_a, user_b) do nothing
  returning id into v_id;

  if v_id is null then
    v_id := private.conversation_between(p_a, p_b);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tetikleyiciler
-- -----------------------------------------------------------------------------

-- Hız sınırı + sohbetin son mesaj zamanı + gönderenin okundu işareti.
create or replace function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := btrim(new.body);
  if (
    select count(*) from public.messages
    where sender_id = new.sender_id and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function private.messages_before_insert();

create or replace function private.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at),
         a_last_read_at = case when c.user_a = new.sender_id
                               then greatest(coalesce(c.a_last_read_at, new.created_at), new.created_at)
                               else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = new.sender_id
                               then greatest(coalesce(c.b_last_read_at, new.created_at), new.created_at)
                               else c.b_last_read_at end
   where c.id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function private.messages_after_insert();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_requests enable row level security;

revoke all on public.conversations, public.messages, public.message_requests
  from public, anon, authenticated;

-- conversations: yalnızca taraflar okur. Oluşturma/güncelleme RPC ile.
grant select on public.conversations to authenticated;

create policy "conversations: taraflar okur"
  on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- messages: yalnızca sohbetin tarafları okur; yalnızca kendi adına, yazmaya
-- izinli olduğu sohbete yazar. Düzenleme/silme yok.
grant select on public.messages to authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;

create policy "messages: sohbetin tarafları okur"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

create policy "messages: izinli sohbete kendi adına yazar"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.can_send_message(conversation_id)
  );

-- message_requests: yalnızca ALICI okur (Realtime bildirimi için). Gönderen
-- kendi isteğinin durumunu (ör. reddedildiğini) tablodan göremez.
grant select on public.message_requests to authenticated;

create policy "message_requests: alıcı okur"
  on public.message_requests for select to authenticated
  using (recipient_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Realtime: RLS'e tabi olarak yayınlanır (abone yalnızca görebildiğini alır).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.message_requests;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC'ler
-- -----------------------------------------------------------------------------

-- Birine ilk kez (ya da tekrar) yazmak. Sonuç:
--   {"kind": "conversation", "id": <sohbet>}  → mesaj sohbete gitti
--   {"kind": "request",      "id": <istek|null>} → mesaj istek olarak gitti
create or replace function public.start_conversation(
  p_target uuid,
  p_body text,
  p_flirt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_mode text;
  v_conversation uuid;
  v_request uuid;
  v_incoming public.message_requests%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if p_target is null or p_target = v_me
     or not private.profile_visible_to(p_target, v_me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  -- Sohbet zaten varsa mesaj doğrudan oraya gider.
  v_conversation := private.conversation_between(v_me, p_target);
  if v_conversation is not null then
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- Karşı taraf zaten bana istek gönderdiyse: yazmam isteği kabul etmek demektir.
  select * into v_incoming from public.message_requests
   where sender_id = p_target and recipient_id = v_me and status = 'pending'
   for update;
  if found then
    v_conversation := public.respond_message_request(v_incoming.id, true);
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- Bu kişiye daha önce gönderilmiş bekleyen ya da reddedilmiş istek var mı?
  -- Reddedildiyse gönderen bunu öğrenmez; yeni istek oluşturulmaz.
  select id into v_request from public.message_requests
   where sender_id = v_me and recipient_id = p_target
     and status in ('pending', 'declined')
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object('kind', 'request', 'id', null);
  end if;

  if p_flirt and not private.flirt_compatible(v_me, p_target) then
    raise exception 'flirt_not_allowed' using errcode = '42501';
  end if;

  v_mode := private.message_mode(p_target, v_me);
  if v_mode = 'not_allowed' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_mode = 'direct' and not p_flirt then
    v_conversation := private.ensure_conversation(v_me, p_target);
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- İstek olarak gönder. Günlük sınır: 20 istek.
  if (
    select count(*) from public.message_requests
    where sender_id = v_me and created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.message_requests (sender_id, recipient_id, body, is_flirt)
  values (v_me, p_target, v_body, coalesce(p_flirt, false))
  returning id into v_request;

  return jsonb_build_object('kind', 'request', 'id', v_request);
end;
$$;

-- Mesaj isteğini kabul et / reddet. Kabul edilirse sohbet id'si döner.
create or replace function public.respond_message_request(p_request uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_req public.message_requests%rowtype;
  v_conversation uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.message_requests
   where id = p_request and recipient_id = v_me and status = 'pending'
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not coalesce(p_accept, false) then
    update public.message_requests
       set status = 'declined', responded_at = now()
     where id = v_req.id;
    return null;
  end if;

  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if private.is_blocked_between(v_me, v_req.sender_id)
     or not private.is_active_user(v_req.sender_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_conversation := private.ensure_conversation(v_me, v_req.sender_id);

  -- İlk mesaj, isteğin gönderildiği zamanla sohbete taşınır.
  insert into public.messages (conversation_id, sender_id, body, created_at)
  values (v_conversation, v_req.sender_id, v_req.body, v_req.created_at);

  update public.message_requests
     set status = 'accepted', responded_at = now(), conversation_id = v_conversation
   where id = v_req.id;

  -- Kabul eden, istek mesajını zaten okudu.
  update public.conversations c
     set a_last_read_at = case when c.user_a = v_me then now() else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = v_me then now() else c.b_last_read_at end
   where c.id = v_conversation;

  return v_conversation;
end;
$$;

-- Sohbet listesi: karşı tarafın gizlilik filtreli bilgisi, son mesaj ve
-- okunmamış sayısı. Engelli ilişkiler listelenmez.
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
      case when c.user_a = auth.uid() then c.a_last_read_at else c.b_last_read_at end as my_last_read
    from public.conversations c
    where auth.uid() in (c.user_a, c.user_b)
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
            'created_at', lm.created_at,
            'from_me', lm.sender_id = auth.uid()
          )
          from public.messages lm
          where lm.conversation_id = m.id
          order by lm.created_at desc
          limit 1
        ),
        'unread_count', (
          select count(*)
          from public.messages um
          where um.conversation_id = m.id
            and um.sender_id <> auth.uid()
            and um.created_at > coalesce(m.my_last_read, '-infinity'::timestamptz)
        )
      ) as row_data
    from mine m
    where not private.is_blocked_between(auth.uid(), m.other_id)
  ) rows
$$;

-- Tek sohbetin başlık bilgisi. Taraf değilse ya da engel varsa null.
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
    'can_send', private.can_send_message(c.id)
  )
  from public.conversations c
  cross join lateral (
    select case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id
  ) o
  where c.id = p_conversation
    and auth.uid() in (c.user_a, c.user_b)
    and not private.is_blocked_between(c.user_a, c.user_b)
$$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations c
     set a_last_read_at = case when c.user_a = auth.uid() then now() else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = auth.uid() then now() else c.b_last_read_at end
   where c.id = p_conversation
     and auth.uid() in (c.user_a, c.user_b)
$$;

-- Bekleyen mesaj istekleri (bana gelen). Engellediklerim ve aktif olmayan
-- hesaplar listelenmez.
create or replace function public.get_message_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'body', r.body,
      'is_flirt', r.is_flirt,
      'created_at', r.created_at,
      'sender', private.profile_card(r.sender_id, auth.uid())
    )
    order by r.created_at desc
  ), '[]'::jsonb)
  from public.message_requests r
  where r.recipient_id = auth.uid()
    and r.status = 'pending'
    and private.is_active_user(r.sender_id)
    and not private.is_blocked_between(r.recipient_id, r.sender_id)
$$;

-- Gezinme rozetleri: okunmamış mesaj sayısı + bekleyen istek sayısı.
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
          '-infinity'::timestamptz
        )
        and not private.is_blocked_between(c.user_a, c.user_b)
    ),
    'pending_requests', (
      select count(*)
      from public.message_requests r
      where r.recipient_id = auth.uid()
        and r.status = 'pending'
        and private.is_active_user(r.sender_id)
        and not private.is_blocked_between(r.recipient_id, r.sender_id)
    )
  )
$$;
