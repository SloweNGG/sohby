-- =============================================================================
-- Keşfet filtreleri: ülke, şehir, cinsiyet, konuştuğu dil (yaş zaten vardı)
-- =============================================================================
-- * Cinsiyet filtresi yalnızca cinsiyetini gösterenleri bulur (show_gender).
-- * discover_places(): Keşfet'te görünen kişilerin bulunduğu ülke ve şehirler
--   (filtre listeleri için). Kartlarda zaten görünen bilgi; sayı döndürmez.

drop function public.discover_profiles(text, text, integer, integer, integer, integer);

create or replace function public.discover_profiles(
  p_filter text default 'all',
  p_search text default null,
  p_min_age integer default null,
  p_max_age integer default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_country text default null,
  p_city_key text default null,
  p_gender text default null,
  p_language text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_me_city_key text;
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
  p_country := upper(nullif(btrim(coalesce(p_country, '')), ''));
  p_city_key := nullif(btrim(coalesce(p_city_key, '')), '');
  p_gender := nullif(btrim(coalesce(p_gender, '')), '');
  p_language := nullif(btrim(coalesce(p_language, '')), '');
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_city_key is not null and char_length(p_city_key) > 80 then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_gender is not null and p_gender not in ('female', 'male', 'other') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_language is not null and p_language !~ '^[a-z]{2}$' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 50 then
    v_search := left(v_search, 50);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 10000);

  select city_key, lower(district) into v_me_city_key, v_me_district
  from public.profiles where id = v_me;

  with candidates as (
    select
      p.id, p.country_code, p.city, p.city_key, p.district, p.gender, p.show_gender, p.languages, p.show_district, p.show_age, p.created_at, p.last_seen_at,
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
           or (v_me_city_key is not null and c.city_key = v_me_city_key))
      and (coalesce(p_filter, 'all') <> 'common_hobby' or c.common_count > 0)
      and (coalesce(p_filter, 'all') <> 'online' or c.online)
      and (coalesce(p_filter, 'all') <> 'flirt' or private.flirt_compatible(v_me, c.id))
      and (p_country is null or c.country_code = p_country)
      and (p_city_key is null or c.city_key = p_city_key)
      -- Cinsiyetini gizleyenler cinsiyet filtresinde görünmez (yaşta olduğu gibi).
      and (p_gender is null or (c.show_gender and c.gender = p_gender))
      and (p_language is null or p_language = any (c.languages))
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

revoke execute on function public.discover_profiles(text, text, integer, integer, integer, integer, text, text, text, text) from public, anon;
grant execute on function public.discover_profiles(text, text, integer, integer, integer, integer, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Filtre listeleri: Keşfet'te bu kullanıcıya görünen kişilerin ülke/şehirleri
-- -----------------------------------------------------------------------------
create or replace function public.discover_places()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('country', x.country_code, 'key', x.city_key, 'city', x.city)
                     order by x.country_code, x.city)
    from (
      select distinct on (p.city_key) p.country_code, p.city_key, p.city
      from public.profiles p
      join public.profile_private pp on pp.id = p.id
      where p.id <> v_me
        and p.city_key is not null
        and p.show_in_discover
        and p.onboarding_completed_at is not null
        and p.deleted_at is null
        and private.is_adult_birth_date(pp.birth_date)
        and private.status_is_active(p.account_status, p.suspended_until)
        and not private.is_blocked_between(v_me, p.id)
        and not private.anon_blocked(p.id, v_me)
      order by p.city_key, p.city
      limit 3000
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.discover_places() from public, anon;
grant execute on function public.discover_places() to authenticated;
