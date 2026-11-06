-- =============================================================================
-- Sohby — 9: Anonim sohbet
-- =============================================================================
-- CLAUDE.md kural 10: Anonim sohbette gönderenin gerçek kimliği alıcıya HİÇBİR
-- API yanıtında sızmaz; engelleme ve şikâyet gerçek hesaba işler.
--
-- Tasarım:
--  * Anonim sohbetler normal sohbetlerden ayrı tablolardadır. Alıcının
--    okuyabildiği hiçbir satırda (anon_conversations, anon_messages, Realtime
--    yükleri) gönderenin kimliği yoktur; yalnızca rastgele takma ad vardır.
--  * Gönderen ↔ sohbet eşlemesi API'ye kapalı `private.anon_senders` tablosunda.
--  * "Kimliğini aç": mesajlar gerçek kimlikle normal sohbete taşınır.
--  * Alıcı anonim göndereni engellerse / şikâyet ederse kayıt gerçek hesaba
--    yazılır; alıcıya dönen yanıtlarda (engellenenler listesi, şikâyetlerim)
--    gerçek kimlik yine görünmez.
--  * Anonim mesajlar her zaman istektir; kabul edilene kadar tek mesaj.
--  * Hız sınırı: günde en çok 5 yeni anonim sohbet (20 yeni kişi sınırına da sayılır).
-- =============================================================================

create table public.anon_conversations (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete restrict,
  alias_adjective text not null,
  alias_animal text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'revealed')),
  reveal_requested_at timestamptz,
  revealed_conversation_id uuid references public.conversations (id) on delete set null,
  anon_last_read_at timestamptz,
  recipient_last_read_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index anon_conversations_recipient_idx on public.anon_conversations (recipient_id, status, created_at desc);

-- Gerçek gönderen yalnızca burada (API'ye kapalı şema, hiçbir rol için yetki yok).
create table private.anon_senders (
  conversation_id uuid primary key references public.anon_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  recipient_id uuid not null references public.profiles (id) on delete restrict,
  constraint anon_one_per_pair unique (sender_id, recipient_id),
  check (sender_id <> recipient_id)
);
alter table private.anon_senders enable row level security;
revoke all on private.anon_senders from public, anon, authenticated;
create index anon_senders_sender_idx on private.anon_senders (sender_id);

create table public.anon_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.anon_conversations (id) on delete restrict,
  -- Gönderenin kimliği yerine yalnızca hangi taraftan geldiği.
  from_anonymous boolean not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index anon_messages_conversation_idx on public.anon_messages (conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Yardımcılar
-- -----------------------------------------------------------------------------
create or replace function private.anon_sender_of(p_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sender_id from private.anon_senders where conversation_id = p_conversation
$$;

-- İzleyenin bu anonim sohbetteki rolü: 'anonymous' | 'recipient' | null
create or replace function private.anon_role(p_conversation uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from private.anon_senders where conversation_id = p_conversation and sender_id = p_user)
      then 'anonymous'
    when exists (select 1 from public.anon_conversations where id = p_conversation and recipient_id = p_user)
      then 'recipient'
  end
$$;

create or replace function private.random_alias(p_recipient uuid, out adjective text, out animal text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_adjectives text[] := array['quiet','secret','curious','shy','brave','calm','cheerful','sleepy','clever','gentle'];
  v_animals text[] := array['fox','owl','cat','panda','otter','deer','rabbit','hedgehog','dolphin','squirrel'];
  i integer;
begin
  -- Aynı alıcıda aynı takma adın tekrarlanmaması denenir.
  for i in 1..20 loop
    adjective := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int];
    animal := v_animals[1 + floor(random() * array_length(v_animals, 1))::int];
    exit when not exists (
      select 1 from public.anon_conversations
      where recipient_id = p_recipient and alias_adjective = adjective and alias_animal = animal
    );
  end loop;
end;
$$;



-- -----------------------------------------------------------------------------
-- Hız sınırı: 20 yeni kişi sınırına anonim sohbetler de sayılır.
-- -----------------------------------------------------------------------------
create or replace function private.new_contacts_last_day(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.message_requests
      where sender_id = p_user and created_at > now() - interval '24 hours')
    +
    (select count(*) from public.conversations
      where initiated_by = p_user and created_at > now() - interval '24 hours')
    +
    (select count(*) from private.anon_senders s
      join public.anon_conversations c on c.id = s.conversation_id
      where s.sender_id = p_user and c.created_at > now() - interval '24 hours')
  )::integer
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.anon_conversations enable row level security;
alter table public.anon_messages enable row level security;
revoke all on public.anon_conversations, public.anon_messages from public, anon, authenticated;

grant select on public.anon_conversations to authenticated;
grant select on public.anon_messages to authenticated;

create policy "anon_conversations: taraflar okur"
  on public.anon_conversations for select to authenticated
  using (private.anon_role(id, (select auth.uid())) is not null);

-- Mesajlar: yalnızca taraflar; bekleyen istekte alıcı da ilk mesajı görür.
create policy "anon_messages: taraflar okur"
  on public.anon_messages for select to authenticated
  using (private.anon_role(conversation_id, (select auth.uid())) is not null);

revoke execute on function private.anon_role(uuid, uuid) from public, anon;
grant execute on function private.anon_role(uuid, uuid) to authenticated;

-- Realtime: yalnızca mesajlar (RLS'e tabi; yükte kimlik yok).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.anon_messages;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Engelleme / şikâyet: gerçek hesaba işler, alıcıya kimlik sızmaz
-- -----------------------------------------------------------------------------
alter table public.blocks
  add column anon_conversation_id uuid references public.anon_conversations (id) on delete set null;

-- Engelleyen, anonim yoldan yaptığı engellerin satırını doğrudan göremez
-- (blocked_id gerçek kimliği verirdi). Bunlar get_blocked_users ile takma adla döner.
drop policy "blocks: engelleyen kendi kayıtlarını okur" on public.blocks;
create policy "blocks: engelleyen kendi kayıtlarını okur"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()) and anon_conversation_id is null);

alter table public.reports
  add column anon_conversation_id uuid references public.anon_conversations (id) on delete set null;

-- Şikâyet eden, kimi şikâyet ettiğini (reported_id) tablodan okuyamaz;
-- anonim şikâyette bu gerçek kimliği verirdi. Diğer sütunlar okunabilir.
revoke select on public.reports from authenticated;
grant select (id, reporter_id, reason, note, conversation_id, message_request_id, anon_conversation_id, status, created_at)
  on public.reports to authenticated;

create or replace function public.get_blocked_users()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by blocked_at desc), '[]'::jsonb)
  from (
    select
      b.created_at as blocked_at,
      case
        when b.anon_conversation_id is null then jsonb_build_object(
          'id', p.id, 'username', p.username,
          'display_name', coalesce(p.display_name, p.username), 'blocked_at', b.created_at,
          'anon_conversation_id', null, 'alias_adjective', null, 'alias_animal', null)
        else jsonb_build_object(
          'id', null, 'username', null, 'display_name', null, 'blocked_at', b.created_at,
          'anon_conversation_id', b.anon_conversation_id,
          'alias_adjective', c.alias_adjective, 'alias_animal', c.alias_animal)
      end as item
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
    left join public.anon_conversations c on c.id = b.anon_conversation_id
    where b.blocker_id = auth.uid()
  ) x
$$;


-- -----------------------------------------------------------------------------
-- Engel türleri: normal engel çift yönlüdür; ANONİM sohbetten yapılan engel
-- yalnızca engellenen kişiyi kısıtlar (engelleyeni göremez, ona yazamaz —
-- kural 6). Engelleyenin görünümünde hiçbir şey değişmez; aksi hâlde "kim
-- kayboldu" karşılaştırmasıyla anonim kişinin kimliği çıkarılabilirdi (kural 10).
-- -----------------------------------------------------------------------------
create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where anon_conversation_id is null
      and ((blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a))
  )
$$;

-- p_blocker, p_blocked'ı anonim bir sohbetten engelledi mi?
create or replace function private.anon_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where blocker_id = p_blocker and blocked_id = p_blocked and anon_conversation_id is not null
  )
$$;

revoke execute on function private.anon_blocked(uuid, uuid) from public, anon;
grant execute on function private.anon_blocked(uuid, uuid) to authenticated;

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
        )
      )
$$;

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
      and private.is_email_verified(auth.uid())
      and private.is_active_user(c.user_a)
      and private.is_active_user(c.user_b)
      and not private.is_blocked_between(c.user_a, c.user_b)
      -- Karşı taraf beni anonim sohbetten engellediyse yazamam (tersi serbest).
      and not private.anon_blocked(case when c.user_a = auth.uid() then c.user_b else c.user_a end, auth.uid())
  )
$$;

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
      and not private.anon_blocked(m.other_id, auth.uid())
  ) rows
$$;

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
  if coalesce(p_filter, 'all') not in ('all', 'nearby', 'common_hobby', 'online', 'flirt') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  -- Flört filtresi yalnızca flört seçmiş (açık rıza vermiş) kullanıcıya açıktır.
  if p_filter = 'flirt' and not private.wants_flirt(v_me) then
    raise exception 'flirt_not_allowed' using errcode = '42501';
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
      p.id, p.city, p.district, p.show_district, p.show_age, p.created_at, p.last_seen_at,
      private.age_years(pp.birth_date) as age,
      private.is_online(p.show_online, p.last_seen_at) as online,
      private.common_hobby_count(p.id, v_me) as common_count,
      p.display_name, p.username
    from public.profiles p
    join public.profile_private pp on pp.id = p.id
    where p.id <> v_me
      and p.show_in_discover
      and p.onboarding_completed_at is not null
      and p.deleted_at is null
      and private.is_adult_birth_date(pp.birth_date)
      and not private.is_blocked_between(v_me, p.id)
      and not private.anon_blocked(p.id, v_me)
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
          c.online desc, c.common_count desc, c.last_seen_at desc nulls last, c.created_at desc, c.id
      ) as rn
    from candidates c
    where (coalesce(p_filter, 'all') <> 'nearby'
           or (v_me_city is not null and lower(c.city) = v_me_city))
      and (coalesce(p_filter, 'all') <> 'common_hobby' or c.common_count > 0)
      and (coalesce(p_filter, 'all') <> 'online' or c.online)
      and (coalesce(p_filter, 'all') <> 'flirt' or private.flirt_compatible(v_me, c.id))
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
-- Anonim sohbete mesaj yazılabilir mi? (iki taraf aktif, engel yok, e-posta doğrulanmış)
create or replace function private.can_send_anon(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.anon_conversations c
    join private.anon_senders s on s.conversation_id = c.id
    where c.id = p_conversation
      and c.status = 'active'
      and p_user in (s.sender_id, c.recipient_id)
      and private.is_email_verified(p_user)
      and private.is_active_user(s.sender_id)
      and private.is_active_user(c.recipient_id)
      and not private.is_blocked_between(s.sender_id, c.recipient_id)
      and not private.anon_blocked(c.recipient_id, s.sender_id)
  )
$$;

-- -----------------------------------------------------------------------------
-- RPC'ler
-- -----------------------------------------------------------------------------

-- Anonim yaz: her zaman istek olarak gider.
create or replace function public.start_anonymous(p_target uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_alias record;
  v_id uuid;
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
  if p_target is null or p_target = v_me or not private.profile_visible_to(p_target, v_me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_target and accept_anonymous) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Zaten tanıştığınız / istek gönderdiğiniz kişiye anonim yazılamaz.
  if private.conversation_between(v_me, p_target) is not null
     or exists (select 1 from public.message_requests
                where (sender_id = v_me and recipient_id = p_target)
                   or (sender_id = p_target and recipient_id = v_me and status = 'pending')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Kişi başına tek anonim sohbet (reddedilse de; gönderen reddi öğrenmez).
  if exists (select 1 from private.anon_senders where sender_id = v_me and recipient_id = p_target) then
    raise exception 'already_sent' using errcode = '42501';
  end if;
  -- Kural 8: anonim için daha düşük sınır + toplam 20 yeni kişi.
  if (
    select count(*) from private.anon_senders s
    join public.anon_conversations c on c.id = s.conversation_id
    where s.sender_id = v_me and c.created_at > now() - interval '24 hours'
  ) >= 5 or private.new_contacts_last_day(v_me) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select * into v_alias from private.random_alias(p_target);

  insert into public.anon_conversations (recipient_id, alias_adjective, alias_animal, last_message_at)
  values (p_target, v_alias.adjective, v_alias.animal, now())
  returning id into v_id;
  insert into private.anon_senders (conversation_id, sender_id, recipient_id) values (v_id, v_me, p_target);
  insert into public.anon_messages (conversation_id, from_anonymous, body) values (v_id, true, v_body);
  update public.anon_conversations set anon_last_read_at = now() where id = v_id;
  return v_id;
end;
$$;

create or replace function public.respond_anonymous(p_conversation uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.anon_conversations
     set status = case when coalesce(p_accept, false) then 'active' else 'declined' end,
         responded_at = now(),
         recipient_last_read_at = case when coalesce(p_accept, false) then now() else recipient_last_read_at end
   where id = p_conversation and recipient_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.send_anon_message(p_conversation uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text := private.anon_role(p_conversation, auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.anon_messages%rowtype;
begin
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not private.can_send_anon(p_conversation, v_me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  -- Dakikada 30 mesaj (tarafın kendi mesajları).
  if (
    select count(*) from public.anon_messages
    where conversation_id = p_conversation
      and from_anonymous = (v_role = 'anonymous')
      and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.anon_messages (conversation_id, from_anonymous, body)
  values (p_conversation, v_role = 'anonymous', v_body)
  returning * into v_row;

  update public.anon_conversations
     set last_message_at = v_row.created_at,
         anon_last_read_at = case when v_role = 'anonymous' then v_row.created_at else anon_last_read_at end,
         recipient_last_read_at = case when v_role = 'recipient' then v_row.created_at else recipient_last_read_at end
   where id = p_conversation;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.mark_anon_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.anon_conversations
     set anon_last_read_at = case when private.anon_role(id, auth.uid()) = 'anonymous' then now() else anon_last_read_at end,
         recipient_last_read_at = case when recipient_id = auth.uid() then now() else recipient_last_read_at end
   where id = p_conversation and private.anon_role(id, auth.uid()) is not null
$$;

-- Alıcı: "Kimliğini açmasını iste"
create or replace function public.request_reveal(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.anon_conversations
     set reveal_requested_at = coalesce(reveal_requested_at, now())
   where id = p_conversation and recipient_id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Anonim gönderen: "Kimliğini aç" → mesajlar gerçek kimlikle normal sohbete taşınır.
create or replace function public.reveal_identity(p_conversation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conv public.anon_conversations%rowtype;
  v_target uuid;
begin
  select * into v_conv from public.anon_conversations where id = p_conversation for update;
  if not found or private.anon_role(p_conversation, v_me) is distinct from 'anonymous' or v_conv.status <> 'active' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not private.can_send_anon(p_conversation, v_me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_target := private.ensure_conversation(v_me, v_conv.recipient_id);

  -- Taşıma sırasında hız sınırı tetikleyicisi devre dışı (eski mesajlar).
  perform set_config('sohby.bulk_move', 'on', true);
  insert into public.messages (conversation_id, sender_id, body, created_at)
  select v_target, case when m.from_anonymous then v_me else v_conv.recipient_id end, m.body, m.created_at
  from public.anon_messages m
  where m.conversation_id = p_conversation
  order by m.created_at;
  perform set_config('sohby.bulk_move', 'off', true);

  update public.conversations c
     set a_last_read_at = case when c.user_a = v_me then now() else greatest(c.a_last_read_at, v_conv.recipient_last_read_at) end,
         b_last_read_at = case when c.user_b = v_me then now() else greatest(c.b_last_read_at, v_conv.recipient_last_read_at) end
   where c.id = v_target;

  update public.anon_conversations
     set status = 'revealed', revealed_conversation_id = v_target
   where id = p_conversation;

  return v_target;
end;
$$;

-- Mesaj hız sınırı tetikleyicisi: kimlik açma taşımasında atlanır.
create or replace function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := btrim(new.body);
  if current_setting('sohby.bulk_move', true) is distinct from 'on' and (
    select count(*) from public.messages
    where sender_id = new.sender_id and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Alıcı anonim göndereni engeller (gerçek hesaba işler).
create or replace function public.block_anonymous(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
begin
  if not exists (select 1 from public.anon_conversations where id = p_conversation and recipient_id = auth.uid()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_sender := private.anon_sender_of(p_conversation);
  insert into public.blocks (blocker_id, blocked_id, anon_conversation_id)
  values (auth.uid(), v_sender, p_conversation)
  on conflict (blocker_id, blocked_id) do nothing;
  -- Anonim sohbet kapanır. Engelleyenin diğer sohbet/isteklerine dokunulmaz
  -- (aksi hâlde kimlik dolaylı olarak açığa çıkardı).
  update public.anon_conversations
     set status = 'declined', responded_at = coalesce(responded_at, now())
   where id = p_conversation and status in ('pending', 'active');
end;
$$;

create or replace function public.unblock_anonymous(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks where blocker_id = auth.uid() and anon_conversation_id = p_conversation
$$;

-- Alıcı anonim göndereni şikâyet eder (gerçek hesaba işler).
create or replace function public.report_anonymous(
  p_conversation uuid,
  p_reason text,
  p_note text default null,
  p_also_block boolean default false
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
  if not exists (select 1 from public.anon_conversations where id = p_conversation and recipient_id = v_me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in (
    'spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'scam', 'hate_speech', 'other'
  ) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if (select count(*) from public.reports where reporter_id = v_me and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, reported_id, reason, note, anon_conversation_id)
  values (v_me, private.anon_sender_of(p_conversation), p_reason, v_note, p_conversation)
  returning id into v_id;

  if coalesce(p_also_block, false) then
    perform public.block_anonymous(p_conversation);
  end if;
  return v_id;
end;
$$;

-- Liste: hem gönderdiğim hem bana gelen anonim sohbetler.
-- Alıcıya dönen öğede gönderen hakkında YALNIZCA takma ad vardır.
create or replace function public.get_anon_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
  from (
    select
      coalesce(c.last_message_at, c.created_at) as sort_at,
      jsonb_build_object(
        'id', c.id,
        'role', r.role,
        -- Gönderen reddi öğrenmez: reddedilmiş sohbet ona "bekliyor" görünür.
        'status', case when r.role = 'anonymous' and c.status = 'declined' then 'pending' else c.status end,
        'alias_adjective', c.alias_adjective,
        'alias_animal', c.alias_animal,
        'reveal_requested', c.reveal_requested_at is not null,
        'created_at', c.created_at,
        -- Gönderen, yazdığı kişiyi zaten tanır; alıcı gönderen hakkında hiçbir şey almaz.
        'recipient', case when r.role = 'anonymous' then private.profile_card(c.recipient_id, auth.uid()) end,
        'last_message', (
          select jsonb_build_object('body', left(m.body, 140), 'created_at', m.created_at,
                                    'from_me', m.from_anonymous = (r.role = 'anonymous'))
          from public.anon_messages m where m.conversation_id = c.id
          order by m.created_at desc limit 1
        ),
        'unread_count', (
          select count(*) from public.anon_messages m
          where m.conversation_id = c.id
            and m.from_anonymous <> (r.role = 'anonymous')
            and m.created_at > coalesce(
              case when r.role = 'anonymous' then c.anon_last_read_at else c.recipient_last_read_at end,
              '-infinity'::timestamptz)
        )
      ) as item
    from public.anon_conversations c
    cross join lateral (select private.anon_role(c.id, auth.uid()) as role) r
    where r.role is not null
      and c.status <> 'revealed'
      -- Alıcı reddettiği anonim istekleri görmez.
      and not (r.role = 'recipient' and c.status = 'declined')
      and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
      and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id))
  ) x
$$;

create or replace function public.get_anon_conversation(p_conversation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'role', r.role,
    -- Gönderen için reddedilmiş sohbet "bekliyor" görünür.
    'status', case when r.role = 'anonymous' and c.status = 'declined' then 'pending' else c.status end,
    'alias_adjective', c.alias_adjective,
    'alias_animal', c.alias_animal,
    'reveal_requested', c.reveal_requested_at is not null,
    'revealed_conversation_id', c.revealed_conversation_id,
    'can_send', private.can_send_anon(c.id, auth.uid()),
    'recipient', case when r.role = 'anonymous' then private.profile_card(c.recipient_id, auth.uid()) end,
    'created_at', c.created_at
  )
  from public.anon_conversations c
  cross join lateral (select private.anon_role(c.id, auth.uid()) as role) r
  where c.id = p_conversation and r.role is not null
    and not (r.role = 'recipient' and c.status = 'declined')
    and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
    and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id))
$$;

-- Rozetler: anonim okunmamışlar ve bekleyen anonim istekler de sayılır.
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
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- 90 günlük saklama: anonim sohbetler de silinmiş hesaplarla birlikte temizlenir.
-- -----------------------------------------------------------------------------
create or replace function private.has_open_report_involving(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    where r.status in ('open', 'reviewing')
      and (
        r.reported_id = p_user
        or r.reporter_id = p_user
        or exists (select 1 from public.conversations c where c.id = r.conversation_id and p_user in (c.user_a, c.user_b))
        or exists (select 1 from public.message_requests mr where mr.id = r.message_request_id and p_user in (mr.sender_id, mr.recipient_id))
        or exists (select 1 from private.anon_senders s where s.conversation_id = r.anon_conversation_id and p_user in (s.sender_id, s.recipient_id))
      )
  )
$$;

create or replace function private.purge_deleted_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.profiles where deleted_at is not null and deleted_at < now() - interval '90 days'
  loop
    if private.has_open_report_involving(v_id) then
      continue;
    end if;
    begin
      delete from public.anon_messages m using private.anon_senders s
       where m.conversation_id = s.conversation_id and v_id in (s.sender_id, s.recipient_id);
      delete from public.anon_conversations c using private.anon_senders s
       where c.id = s.conversation_id and v_id in (s.sender_id, s.recipient_id);
      delete from public.messages m using public.conversations c
       where m.conversation_id = c.id and v_id in (c.user_a, c.user_b);
      delete from public.conversations where v_id in (user_a, user_b);
      delete from public.message_requests where v_id in (sender_id, recipient_id);
      delete from auth.users where id = v_id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'purge_deleted_accounts: % silinemedi: %', v_id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler (yeni fonksiyonlar)
-- -----------------------------------------------------------------------------
revoke execute on function private.anon_sender_of(uuid) from public, anon, authenticated;
revoke execute on function private.random_alias(uuid) from public, anon, authenticated;
revoke execute on function private.can_send_anon(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.start_anonymous(uuid, text) from public, anon, authenticated;
revoke execute on function public.respond_anonymous(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.send_anon_message(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_anon_read(uuid) from public, anon, authenticated;
revoke execute on function public.request_reveal(uuid) from public, anon, authenticated;
revoke execute on function public.reveal_identity(uuid) from public, anon, authenticated;
revoke execute on function public.block_anonymous(uuid) from public, anon, authenticated;
revoke execute on function public.unblock_anonymous(uuid) from public, anon, authenticated;
revoke execute on function public.report_anonymous(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.get_anon_conversations() from public, anon, authenticated;
revoke execute on function public.get_anon_conversation(uuid) from public, anon, authenticated;

grant execute on function public.start_anonymous(uuid, text) to authenticated;
grant execute on function public.respond_anonymous(uuid, boolean) to authenticated;
grant execute on function public.send_anon_message(uuid, text) to authenticated;
grant execute on function public.mark_anon_read(uuid) to authenticated;
grant execute on function public.request_reveal(uuid) to authenticated;
grant execute on function public.reveal_identity(uuid) to authenticated;
grant execute on function public.block_anonymous(uuid) to authenticated;
grant execute on function public.unblock_anonymous(uuid) to authenticated;
grant execute on function public.report_anonymous(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_anon_conversations() to authenticated;
grant execute on function public.get_anon_conversation(uuid) to authenticated;
