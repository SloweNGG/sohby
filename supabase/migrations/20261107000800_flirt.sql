-- =============================================================================
-- Sohby — 8: Flört
-- =============================================================================
-- * Flört seçenler yalnızca birbirini flört amacıyla görür: Keşfet'te "Flört"
--   filtresi yalnızca flört seçmiş kullanıcıya açıktır ve yalnızca KARŞILIKLI
--   uyumlu (iki taraf da flört seçmiş, rıza vermiş, birbirinin ilgilendiği
--   cinsiyete uyan) kişileri döndürür.
-- * Eşleştirme yalnızca private.dating_preferences'tan yapılır (kural 11);
--   dışarıya yalnızca evet/hayır sızar.
-- * Flört etiketli mesaj istekleri start_conversation(p_flirt => true) ile
--   gönderilir ve yalnızca uyumlu kişiye gidebilir (önceki migration'lar).
-- =============================================================================

create or replace function private.wants_flirt(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join private.dating_preferences d on d.user_id = p.id
    where p.id = p_user and 'flirt' = any (p.looking_for)
  )
$$;

revoke execute on function private.wants_flirt(uuid) from public, anon, authenticated;

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
