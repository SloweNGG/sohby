-- =============================================================================
-- Sohby — 11: Hesap durumları (yaş doğrulaması, askı, kapatma) ve itiraz
-- =============================================================================
-- * Durumu yalnızca yönetim (yönetim paneli / service_role) değiştirir;
--   kullanıcı kendi durumunu güncelleyemez (sütun yetkisi yok).
-- * Aktif olmayan kullanıcı hiçbir sosyal işlem yapamaz: private.is_active_user
--   durumu da denetler (Keşfet, mesaj, istek, anonim, fotoğraf görüntüleme…).
-- * Süreli askı, süresi dolunca kendiliğinden kalkar.
-- * Aktif olmayan kullanıcı itiraz gönderebilir (aynı anda bir açık itiraz).
-- * Yaş doğrulama belgesi yükleme (kural 15: şifreli, ayrı bucket, 30 gün)
--   sonraki adımda; bu ekran şimdilik itiraz/açıklama ile çalışır.
-- =============================================================================

alter table public.profiles
  add column account_status text not null default 'active'
    check (account_status in ('active', 'age_verification_required', 'suspended', 'closed')),
  add column status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  add column suspended_until timestamptz,
  add column status_changed_at timestamptz;

create or replace function private.status_is_active(p_status text, p_suspended_until timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'active'
      or (p_status = 'suspended' and p_suspended_until is not null and p_suspended_until <= now())
$$;

create or replace function private.is_active_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.profile_private pp on pp.id = p.id
    where p.id = p_user
      and p.onboarding_completed_at is not null
      and p.deleted_at is null
      and private.is_adult_birth_date(pp.birth_date)
      and private.status_is_active(p.account_status, p.suspended_until)
  )
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
      and private.status_is_active(p.account_status, p.suspended_until)
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

-- -----------------------------------------------------------------------------
-- İtirazlar
-- -----------------------------------------------------------------------------
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_status text not null,
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
create index appeals_open_idx on public.appeals (created_at) where status = 'open';
create unique index appeals_one_open_per_user on public.appeals (user_id) where status = 'open';

alter table public.appeals enable row level security;
revoke all on public.appeals from public, anon, authenticated;
grant select on public.appeals to authenticated;
create policy "appeals: sahibi okur"
  on public.appeals for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.submit_appeal(p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_status text;
  v_until timestamptz;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select account_status, suspended_until into v_status, v_until from public.profiles where id = v_me;
  if v_status is null or private.status_is_active(v_status, v_until) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 2000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if exists (select 1 from public.appeals where user_id = v_me and status = 'open') then
    raise exception 'already_open' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appeals where user_id = v_me and created_at > now() - interval '7 days') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.appeals (user_id, account_status, message)
  values (v_me, v_status, btrim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function private.status_is_active(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.submit_appeal(text) from public, anon, authenticated;
grant execute on function public.submit_appeal(text) to authenticated;
