-- =============================================================================
-- Sohby — 3/3: Keşfet, kişi profili, engelleme, şikâyet, fonksiyon yetkileri
-- =============================================================================

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  reported_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in (
    'spam', 'harassment', 'inappropriate_content', 'fake_profile',
    'underage', 'scam', 'hate_speech', 'other'
  )),
  note text check (note is null or char_length(note) <= 1000),
  conversation_id uuid references public.conversations (id) on delete set null,
  message_request_id uuid references public.message_requests (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

comment on table public.reports is
  'Şikâyetler. Kullanıcı yalnızca kendi şikâyetlerini görür; inceleme service_role ile (panel) yapılır.';

create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_reported_idx on public.reports (reported_id, created_at desc);
create index reports_open_idx on public.reports (created_at) where status = 'open';

-- -----------------------------------------------------------------------------
-- RLS: blocks, reports
-- -----------------------------------------------------------------------------
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

revoke all on public.blocks, public.reports from public, anon, authenticated;

-- blocks: yalnızca engelleyen kendi kaydını görür. Engellenen kişi engellendiğini
-- tablodan öğrenemez. Ekleme/silme RPC ile.
grant select on public.blocks to authenticated;

create policy "blocks: engelleyen kendi kayıtlarını okur"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- reports: yalnızca şikâyet eden kendi şikâyetlerini görür. Ekleme RPC ile;
-- güncelleme/silme yok.
grant select on public.reports to authenticated;

create policy "reports: şikâyet eden kendi kayıtlarını okur"
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Keşfet
-- -----------------------------------------------------------------------------
-- p_filter: 'all' | 'nearby' (aynı şehir, aynı semt önce) | 'common_hobby' | 'online'
-- Yaş filtresi yalnızca yaşını gösteren kişilere uygulanır (gizli yaş filtreyle
-- tahmin edilemesin diye yaşı gizli olanlar yaş filtresinde hiç dönmez).
-- Arama: ad, kullanıcı adı, şehir, (görünürse) semt, hobi adı. LIKE yerine
-- position() kullanılır → joker karakter enjeksiyonu yok.
create or replace function public.discover_profiles(
  p_filter text default 'all',
  p_search text default null,
  p_min_age integer default null,
  p_max_age integer default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_me_city text;
  v_me_district text;
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_result jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if coalesce(p_filter, 'all') not in ('all', 'nearby', 'common_hobby', 'online') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 50 then
    v_search := left(v_search, 50);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 10000);

  select lower(city), lower(district) into v_me_city, v_me_district
  from public.profiles where id = v_me;

  with candidates as (
    select
      p.id,
      p.city,
      p.district,
      p.show_district,
      p.show_age,
      p.created_at,
      p.last_seen_at,
      private.age_years(pp.birth_date) as age,
      private.is_online(p.show_online, p.last_seen_at) as online,
      private.common_hobby_count(p.id, v_me) as common_count,
      p.display_name,
      p.username
    from public.profiles p
    join public.profile_private pp on pp.id = p.id
    where p.id <> v_me
      and p.show_in_discover
      and p.onboarding_completed_at is not null
      and private.is_adult_birth_date(pp.birth_date)
      and not private.is_blocked_between(v_me, p.id)
  ),
  filtered as (
    select c.*,
      row_number() over (
        order by
          case
            when p_filter = 'nearby' and c.show_district
             and v_me_district is not null and lower(c.district) = v_me_district then 0
            else 1
          end,
          c.online desc,
          c.common_count desc,
          c.last_seen_at desc nulls last,
          c.created_at desc,
          c.id
      ) as rn
    from candidates c
    where (coalesce(p_filter, 'all') <> 'nearby'
           or (v_me_city is not null and lower(c.city) = v_me_city))
      and (coalesce(p_filter, 'all') <> 'common_hobby' or c.common_count > 0)
      and (coalesce(p_filter, 'all') <> 'online' or c.online)
      and (p_min_age is null or (c.show_age and c.age >= p_min_age))
      and (p_max_age is null or (c.show_age and c.age <= p_max_age))
      and (
        v_search is null
        or position(v_search in lower(coalesce(c.display_name, ''))) > 0
        or position(v_search in c.username) > 0
        or position(v_search in lower(coalesce(c.city, ''))) > 0
        or (c.show_district and position(v_search in lower(coalesce(c.district, ''))) > 0)
        or exists (
          select 1
          from public.profile_hobbies ph
          join public.hobbies h on h.id = ph.hobby_id
          where ph.profile_id = c.id
            and (position(v_search in lower(h.name_tr)) > 0
                 or position(v_search in lower(h.name_en)) > 0)
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

-- -----------------------------------------------------------------------------
-- Kişi profili
-- -----------------------------------------------------------------------------
-- Görünür değilse (engel, keşfette gizli ve hiç yazışmamış, aktif değil) null.
create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_incoming uuid;
  v_outgoing boolean;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select id into v_target from public.profiles
   where username = lower(btrim(coalesce(p_username, '')));
  if v_target is null then
    return null;
  end if;

  if v_target = v_me then
    return private.profile_card(v_target, v_me) || jsonb_build_object(
      'is_self', true,
      'message_mode', 'not_allowed',
      'conversation_id', null,
      'incoming_request_id', null,
      'outgoing_request_pending', false,
      'flirt_compatible', false
    );
  end if;

  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if not private.profile_visible_to(v_target, v_me) then
    return null;
  end if;

  select id into v_incoming from public.message_requests
   where sender_id = v_target and recipient_id = v_me and status = 'pending';

  -- Reddedilmiş istekler de gönderene "bekliyor" olarak görünür.
  select exists (
    select 1 from public.message_requests
    where sender_id = v_me and recipient_id = v_target and status in ('pending', 'declined')
  ) into v_outgoing;

  return private.profile_card(v_target, v_me) || jsonb_build_object(
    'is_self', false,
    'message_mode', private.message_mode(v_target, v_me),
    'conversation_id', private.conversation_between(v_target, v_me),
    'incoming_request_id', v_incoming,
    'outgoing_request_pending', coalesce(v_outgoing, false),
    'flirt_compatible', private.flirt_compatible(v_me, v_target)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Engelleme
-- -----------------------------------------------------------------------------
create or replace function public.block_user(p_target uuid)
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
  if p_target is null or p_target = v_me
     or not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (v_me, p_target)
  on conflict do nothing;

  -- Aradaki bekleyen istekler (iki yönde de) kapatılır.
  update public.message_requests
     set status = 'declined', responded_at = now()
   where status = 'pending'
     and ((sender_id = v_me and recipient_id = p_target)
       or (sender_id = p_target and recipient_id = v_me));
end;
$$;

create or replace function public.unblock_user(p_target uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks
  where blocker_id = auth.uid() and blocked_id = p_target
$$;

-- Engellediğim kişiler (Ayarlar > Engellenenler). Yalnızca ad bilgisi döner.
create or replace function public.get_blocked_users()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', coalesce(p.display_name, p.username),
      'blocked_at', b.created_at
    )
    order by b.created_at desc
  ), '[]'::jsonb)
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- Şikâyet
-- -----------------------------------------------------------------------------
-- Sohbet/istek bağlamı verilirse şikâyet edenle şikâyet edilen arasında
-- olmalıdır. Günlük sınır: 10 şikâyet. İsteğe bağlı olarak aynı anda engeller.
create or replace function public.report_user(
  p_target uuid,
  p_reason text,
  p_note text default null,
  p_also_block boolean default false,
  p_conversation uuid default null,
  p_request uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_target is null or p_target = v_me
     or not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in (
    'spam', 'harassment', 'inappropriate_content', 'fake_profile',
    'underage', 'scam', 'hate_speech', 'other'
  ) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if p_conversation is not null and not exists (
    select 1 from public.conversations
    where id = p_conversation
      and user_a = least(v_me, p_target) and user_b = greatest(v_me, p_target)
  ) then
    raise exception 'invalid_context' using errcode = '22023';
  end if;
  if p_request is not null and not exists (
    select 1 from public.message_requests
    where id = p_request
      and ((sender_id = p_target and recipient_id = v_me)
        or (sender_id = v_me and recipient_id = p_target))
  ) then
    raise exception 'invalid_context' using errcode = '22023';
  end if;

  if (
    select count(*) from public.reports
    where reporter_id = v_me and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, reported_id, reason, note, conversation_id, message_request_id)
  values (v_me, p_target, p_reason, v_note, p_conversation, p_request)
  returning id into v_id;

  if coalesce(p_also_block, false) then
    perform public.block_user(p_target);
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fonksiyon yetkileri
-- -----------------------------------------------------------------------------
-- PostgreSQL varsayılan olarak her fonksiyonu PUBLIC'e açar; Supabase ayrıca
-- anon/authenticated'a verir. Hepsini geri alıp yalnızca gerekenleri açıyoruz.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- RLS politikalarında kullanılanlar
grant execute on function private.can_send_message(uuid) to authenticated;

-- Kayıt formu (giriş yapmamış kullanıcı)
grant execute on function public.username_available(text) to anon, authenticated;

-- Giriş yapmış kullanıcı
grant execute on function public.set_birth_date(date) to authenticated;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.discover_profiles(text, text, integer, integer, integer, integer) to authenticated;
grant execute on function public.get_profile(text) to authenticated;
grant execute on function public.start_conversation(uuid, text, boolean) to authenticated;
grant execute on function public.respond_message_request(uuid, boolean) to authenticated;
grant execute on function public.get_conversations() to authenticated;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.get_message_requests() to authenticated;
grant execute on function public.get_badge_counts() to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.get_blocked_users() to authenticated;
grant execute on function public.report_user(uuid, text, text, boolean, uuid, uuid) to authenticated;

-- ÖNEMLİ (ileride eklenecek migration'lar için): PostgreSQL yeni fonksiyonları
-- PUBLIC'e, Supabase de anon/authenticated'a otomatik açar ve bu şema bazında
-- geri alınamaz. Her yeni fonksiyondan sonra açıkça
--   revoke execute on function ... from public, anon, authenticated;
-- yazılmalı ve yalnızca gereken role grant verilmelidir.
