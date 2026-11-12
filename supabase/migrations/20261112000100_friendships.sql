-- =============================================================================
-- Sohby — Arkadaşlık sistemi
-- =============================================================================
-- * Arkadaşlık isteği → alıcı kabul ederse iki kişi arkadaş olur
--   (friendships, çift başına tek satır, user_a < user_b).
-- * Tablolara doğrudan erişim yoktur; her şey RPC'lerle yapılır (kural 1).
-- * İstek göndermek için: e-posta doğrulanmış (kural 9), hesap etkin, karşı
--   taraf görünür ve aradaki engel yok (kural 6). Günde en çok 20 istek (kural 8
--   ile aynı sınır; geri çekilen istekler de sayılır).
-- * Reddedilen istek: gönderen bunu öğrenmez, "İstek gönderildi" görmeye devam
--   eder ve aynı kişiye yeniden istek gönderemez (mesaj istekleriyle aynı).
-- * Engelleme (anonim sohbetten yapılan hariç — kural 10) arkadaşlığı ve
--   bekleyen istekleri kaldırır.
-- * Arkadaş listesi profilde yalnızca sahibi "Arkadaş listem" ayarını açtıysa
--   görünür (varsayılan kapalı). Listesini gizleyen arkadaşlar başkalarının
--   listesinde de gösterilmez.
-- * Fotoğraf izni (kural 5): yeni seçenek "Yalnızca arkadaşlarım".
-- * Arkadaşlar, Keşfet'te görünmeyi kapatmış olsalar da birbirini görebilir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tablolar
-- -----------------------------------------------------------------------------
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  -- Reddedilmiş isteği gönderen "geri çekti": kendi ekranında yeniden
  -- "Arkadaş ekle" görür; yeniden gönderirse istek sessizce reddedilmiş kalır.
  sender_withdrew boolean not null default false,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);

-- Çift başına (yön başına) tek açık kayıt: bekleyen ya da reddedilmiş.
create unique index friend_requests_one_open_per_pair
  on public.friend_requests (sender_id, recipient_id)
  where status in ('pending', 'declined');
create index friend_requests_recipient_idx
  on public.friend_requests (recipient_id, status, created_at desc);
create index friend_requests_sender_idx
  on public.friend_requests (sender_id, created_at desc);

create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_requests, public.friendships from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Profil ayarları
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column show_friends boolean not null default false;
comment on column public.profiles.show_friends is
  'Arkadaş listesi profilde görünsün mü (varsayılan kapalı).';
grant update (show_friends) on public.profiles to authenticated;

-- Fotoğraf izni: herkes (kabul ettiğim sohbetler) / yalnızca arkadaşlarım / kimse.
alter table public.profiles drop constraint profiles_photo_permission_check;
alter table public.profiles add constraint profiles_photo_permission_check
  check (photo_permission in ('accepted_chats', 'friends', 'nobody'));

-- -----------------------------------------------------------------------------
-- Yardımcılar
-- -----------------------------------------------------------------------------
create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.friendships
    where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b)
  )
$$;

-- İzleyenin gözünden hedefle arkadaşlık durumu:
-- 'self' | 'friends' | 'incoming' (hedef bana istek gönderdi) |
-- 'outgoing' (ben gönderdim; reddedildiyse de böyle görünür) | 'none'
create or replace function private.friend_state(p_target uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_target = p_viewer then 'self'
    when private.are_friends(p_target, p_viewer) then 'friends'
    when exists (select 1 from public.friend_requests
                 where sender_id = p_target and recipient_id = p_viewer and status = 'pending') then 'incoming'
    when exists (select 1 from public.friend_requests
                 where sender_id = p_viewer and recipient_id = p_target
                   and status in ('pending', 'declined') and not sender_withdrew) then 'outgoing'
    else 'none'
  end
$$;

-- Listelerde kullanılan küçük kişi kartı.
create or replace function private.friend_card(p_user uuid)
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
    'photo_path', private.current_photo_path(p.id),
    'is_online', private.is_online(p.show_online, p.last_seen_at)
  )
  from public.profiles p
  where p.id = p_user
$$;

-- Görünürlük: arkadaşlar ve bana arkadaşlık isteği gönderen kişi de görünür
-- (Keşfet'te görünmeyi kapatmış olsalar bile). Kural 6 ve 10 aynen geçerli.
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
        -- Hedef, izleyeni anonim sohbetten engellediyse izleyen hedefi göremez.
        and not private.anon_blocked(p_target, p_viewer)
        and (
          exists (select 1 from public.profiles where id = p_target and show_in_discover)
          or private.conversation_between(p_target, p_viewer) is not null
          or exists (
            select 1 from public.message_requests
            where sender_id = p_target and recipient_id = p_viewer
          )
          or private.are_friends(p_target, p_viewer)
          or exists (
            select 1 from public.friend_requests
            where sender_id = p_target and recipient_id = p_viewer and status = 'pending'
          )
        )
      )
$$;

-- -----------------------------------------------------------------------------
-- Engelleme: arkadaşlık ve açık istekler kalkar. Anonim sohbetten yapılan
-- engel dokunmaz (dokunsaydı alıcı, listesinden kimin kaybolduğuna bakarak
-- göndereni tahmin edebilirdi — kural 10).
-- -----------------------------------------------------------------------------
create or replace function private.blocks_after_insert_friends()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anon_conversation_id is not null then
    return null;
  end if;
  delete from public.friendships
   where user_a = least(new.blocker_id, new.blocked_id)
     and user_b = greatest(new.blocker_id, new.blocked_id);
  -- Engelleyenin kendi isteği geri çekilir; engellenenin isteği reddedilir.
  update public.friend_requests
     set status = 'cancelled', responded_at = now()
   where sender_id = new.blocker_id and recipient_id = new.blocked_id
     and status in ('pending', 'declined');
  update public.friend_requests
     set status = 'declined', responded_at = now()
   where sender_id = new.blocked_id and recipient_id = new.blocker_id
     and status = 'pending';
  return null;
end;
$$;

create trigger blocks_after_insert_friends
  after insert on public.blocks
  for each row execute function private.blocks_after_insert_friends();

-- -----------------------------------------------------------------------------
-- RPC'ler
-- -----------------------------------------------------------------------------

-- Arkadaşlık isteğini kabul et / reddet. Yeni durum döner: 'friends' | 'declined'.
create or replace function public.respond_friend_request(p_request uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_req public.friend_requests%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.friend_requests
   where id = p_request and recipient_id = v_me and status = 'pending'
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not coalesce(p_accept, false) then
    update public.friend_requests
       set status = 'declined', responded_at = now()
     where id = v_req.id;
    return 'declined';
  end if;

  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if private.is_blocked_between(v_me, v_req.sender_id)
     or not private.is_active_user(v_req.sender_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(v_me, v_req.sender_id), greatest(v_me, v_req.sender_id))
  on conflict do nothing;

  update public.friend_requests
     set status = 'accepted', responded_at = now()
   where id = v_req.id;

  -- Ters yönde açık kalmış (ör. daha önce reddedilmiş) istek de kapanır.
  update public.friend_requests
     set status = 'accepted', responded_at = now()
   where sender_id = v_me and recipient_id = v_req.sender_id
     and status in ('pending', 'declined');

  return 'friends';
end;
$$;

-- Arkadaşlık isteği gönder. Yeni durum döner: 'friends' | 'outgoing'.
create or replace function public.send_friend_request(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_incoming uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if not private.is_email_verified(v_me) then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;
  if p_target is null or p_target = v_me
     or not private.profile_visible_to(p_target, v_me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if private.are_friends(v_me, p_target) then
    return 'friends';
  end if;

  -- Karşı taraf zaten bana istek gönderdiyse: göndermek kabul etmek demektir.
  select id into v_incoming from public.friend_requests
   where sender_id = p_target and recipient_id = v_me and status = 'pending'
   for update;
  if found then
    return public.respond_friend_request(v_incoming, true);
  end if;

  -- Daha önce gönderilmiş açık istek (bekleyen ya da reddedilmiş): yeni istek
  -- oluşmaz; reddedildiyse gönderen bunu öğrenmez.
  update public.friend_requests
     set sender_withdrew = false
   where sender_id = v_me and recipient_id = p_target
     and status in ('pending', 'declined');
  if found then
    return 'outgoing';
  end if;

  if (
    select count(*) from public.friend_requests
    where sender_id = v_me and created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.friend_requests (sender_id, recipient_id)
  values (v_me, p_target);
  return 'outgoing';
end;
$$;

-- Gönderdiğim isteği geri çek.
create or replace function public.cancel_friend_request(p_target uuid)
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
  update public.friend_requests
     set status = 'cancelled', responded_at = now()
   where sender_id = v_me and recipient_id = p_target and status = 'pending';
  update public.friend_requests
     set sender_withdrew = true
   where sender_id = v_me and recipient_id = p_target and status = 'declined';
end;
$$;

-- Arkadaşlıktan çıkar (karşı tarafa bildirim gitmez).
create or replace function public.remove_friend(p_target uuid)
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
  delete from public.friendships
   where user_a = least(v_me, p_target) and user_b = greatest(v_me, p_target);
end;
$$;

-- Bir kişinin arkadaş listesi.
-- * Kendi listem: tüm (etkin) arkadaşlarım.
-- * Başkasının listesi: yalnızca o kişi listesini açtıysa ve bana görünürse;
--   listede yalnızca listesini açmış ve bana görünen arkadaşlar çıkar.
-- Dönen: {visible, is_self, total, mutual_count, items[]}; profil yoksa null.
create or replace function public.get_friends(p_username text, p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_self boolean;
  v_show boolean;
  v_result jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select id, show_friends into v_target, v_show from public.profiles
   where username = lower(btrim(coalesce(p_username, '')));
  if v_target is null then
    return null;
  end if;
  v_self := v_target = v_me;

  if not v_self then
    if not private.is_active_user(v_me) then
      raise exception 'onboarding_required' using errcode = '42501';
    end if;
    if not private.profile_visible_to(v_target, v_me) then
      return null;
    end if;
    if not v_show then
      return jsonb_build_object('visible', false, 'is_self', false, 'total', 0, 'mutual_count', 0, 'items', '[]'::jsonb);
    end if;
  end if;

  with friends as (
    select
      case when f.user_a = v_target then f.user_b else f.user_a end as id,
      f.created_at
    from public.friendships f
    where v_target in (f.user_a, f.user_b)
  ),
  shown as (
    select
      fr.id,
      fr.created_at,
      (not v_self and fr.id <> v_me and private.are_friends(fr.id, v_me)) as mutual
    from friends fr
    join public.profiles p on p.id = fr.id
    where private.is_active_user(fr.id)
      and (
        v_self
        or (p.show_friends and (fr.id = v_me or private.profile_visible_to(fr.id, v_me)))
      )
  )
  select jsonb_build_object(
    'visible', true,
    'is_self', v_self,
    'total', (select count(*) from shown),
    'mutual_count', (select count(*) from shown where mutual),
    'items', coalesce((
      select jsonb_agg(item order by mutual desc, online desc, created_at desc)
      from (
        select
          s.mutual,
          s.created_at,
          coalesce((private.friend_card(s.id) ->> 'is_online')::boolean, false) as online,
          private.friend_card(s.id) || jsonb_build_object('is_mutual', s.mutual, 'is_me', s.id = v_me, 'since', s.created_at) as item
        from shown s
        order by s.mutual desc, s.created_at desc
        limit p_limit
      ) x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Profil sayfası için: arkadaşlık durumu + arkadaş listesi önizlemesi.
create or replace function public.get_profile_friends(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_list jsonb;
begin
  v_list := public.get_friends(p_username, 8);
  if v_list is null then
    return null;
  end if;
  select id into v_target from public.profiles
   where username = lower(btrim(coalesce(p_username, '')));
  return jsonb_build_object(
    'state', private.friend_state(v_target, v_me),
    'incoming_request_id', (
      select id from public.friend_requests
      where sender_id = v_target and recipient_id = v_me and status = 'pending'
    ),
    'list', v_list
  );
end;
$$;

-- Bana gelen bekleyen istekler ve benim gönderdiklerim (reddedilenler de
-- "bekliyor" görünür). Engelli ve etkin olmayan hesaplar listelenmez.
create or replace function public.get_friend_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'user', private.friend_card(r.sender_id))
                       order by r.created_at desc)
      from public.friend_requests r
      where r.recipient_id = auth.uid() and r.status = 'pending'
        and private.is_active_user(r.sender_id)
        and not private.is_blocked_between(r.sender_id, r.recipient_id)
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'user', private.friend_card(r.recipient_id))
                       order by r.created_at desc)
      from public.friend_requests r
      where r.sender_id = auth.uid() and r.status in ('pending', 'declined') and not r.sender_withdrew
        and private.is_active_user(r.recipient_id)
        and not private.is_blocked_between(r.sender_id, r.recipient_id)
        and not private.anon_blocked(r.recipient_id, r.sender_id)
    ), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- Sohbette fotoğraf: "Yalnızca arkadaşlarım" izni (kural 5)
-- -----------------------------------------------------------------------------
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
  v_permission text;
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
  select photo_permission into v_permission from public.profiles where id = v_other;
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
  if (select count(*) from private.chat_photo_uploads
      where user_id = p_user and created_at > now() - interval '24 hours') >= 50 then
    return 'rate_limited';
  end if;
  return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
-- Yardımcılar yalnızca SECURITY DEFINER fonksiyonların içinden çağrılır.
revoke execute on function private.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.friend_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.friend_card(uuid) from public, anon, authenticated;
revoke execute on function private.blocks_after_insert_friends() from public, anon, authenticated;
revoke execute on function private.profile_visible_to(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_photo_status(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.cancel_friend_request(uuid) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.get_friends(text, integer) from public, anon;
revoke execute on function public.get_profile_friends(text) from public, anon;
revoke execute on function public.get_friend_requests() from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.get_friends(text, integer) to authenticated;
grant execute on function public.get_profile_friends(text) to authenticated;
grant execute on function public.get_friend_requests() to authenticated;
