-- =============================================================================
-- Yurt dışındaki kullanıcılar: ülke + şehir
-- =============================================================================
-- * Profilde ülke (ISO kodu, varsayılan TR) tutulur.
-- * Türkiye'de şehir 81 il listesinden seçilir (artık veritabanında da denetlenir).
-- * Diğer ülkelerde şehir hazır dünya şehirleri listesinden (public.world_cities)
--   seçilir; profil yalnızca listedeki kaydın numarasını gönderir, şehir adını
--   veritabanı yazar. Böylece "Köln" ile "Cologne" aynı şehir sayılır.
-- * "Yakınımdakiler" eşleşmesi city_key ile yapılır (aynı ülke + aynı şehir).
-- * Kural 12: yalnızca şehir/semt düzeyi; şehir listesinde de koordinat yok.

-- -----------------------------------------------------------------------------
-- Dünya şehirleri (verisi bir sonraki migration'da)
-- -----------------------------------------------------------------------------
create table public.world_cities (
  id integer primary key,                 -- GeoNames numarası
  country_code text not null check (country_code ~ '^[A-Z]{2}$' and country_code <> 'TR'),
  name text not null check (char_length(name) between 1 and 60),
  region text,                            -- eyalet/bölge (aynı adlı şehirleri ayırmak için)
  inhabitants integer not null default 0,
  search text not null                    -- '|ad|diğer adlar|' (geo_fold ile sadeleştirilmiş)
);

create index world_cities_country_idx on public.world_cities (country_code, inhabitants desc);

-- Doğrudan erişim yok; arama yalnızca search_cities() ile.
alter table public.world_cities enable row level security;
revoke all on public.world_cities from public, anon, authenticated;

-- Aramada aksan ve büyük/küçük harf farkını kaldırır: "Münih" → "munih".
-- Eşleme tablosu scripts/world-cities.py ile üretilir (veriyle birebir aynı).
create or replace function private.geo_fold(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(lower(translate(coalesce(p_text, ''),
    'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǝǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẞẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹə-''’ʻʼ`.‘',
    'aaaaaaaceeeeiiiidnoooooouuuuytsaaaaaaaceeeeiiiidnoooooouuuuytyaaaaaaccccccccddddeeeeeeeeeegggggggghhhhiiiiiiiiiijjkkkllllllllllnnnnnnnnnoooooooorrrrrrssssssssttttttuuuuuuuuuuuuwwyyyzzzzzzsefoouuaaiioouuuuuuuuuueaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyassaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyye ')))
$$;

-- Türkiye'nin 81 ili (src/lib/data/cities.ts ile aynı).
create or replace function private.tr_cities()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin',
    'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale',
    'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir',
    'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkâri', 'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir',
    'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya',
    'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Rize',
    'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli',
    'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale',
    'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
    'Düzce'
  ]::text[]
$$;

-- -----------------------------------------------------------------------------
-- Profil: ülke, şehir numarası, eşleşme anahtarı
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column country_code text not null default 'TR' check (country_code ~ '^[A-Z]{2}$'),
  add column city_id integer references public.world_cities (id),
  add column city_key text generated always as (
    case
      when city is null then null
      when city_id is not null then 'g:' || city_id::text
      else lower(country_code) || ':' || lower(city)
    end
  ) stored;

drop index if exists public.profiles_city_idx;
create index profiles_city_key_idx on public.profiles (city_key);

grant update (country_code, city_id) on public.profiles to authenticated;

-- Konum denetimi. profiles_before_update'ten sonra çalışır (tetikleyiciler ad
-- sırasıyla çalışır), yani şehir adı önceden kırpılmış olur.
create or replace function private.profiles_location_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city public.world_cities%rowtype;
begin
  new.country_code := upper(btrim(coalesce(new.country_code, '')));

  if new.country_code is not distinct from old.country_code
     and new.city is not distinct from old.city
     and new.city_id is not distinct from old.city_id then
    return new;
  end if;

  if new.country_code = 'TR' then
    new.city_id := null;
    if new.city is not null and not (new.city = any (private.tr_cities())) then
      raise exception 'invalid_city' using errcode = '22023';
    end if;
  elsif new.city_id is null then
    -- Şehir seçilmeden ülke değiştirilemez (yarım konum kalmasın).
    if new.city is not null then
      raise exception 'invalid_city' using errcode = '22023';
    end if;
  else
    select * into v_city from public.world_cities
    where id = new.city_id and country_code = new.country_code;
    if not found then
      raise exception 'invalid_city' using errcode = '22023';
    end if;
    new.city := v_city.name;
  end if;

  return new;
end;
$$;

create trigger profiles_location_before_update
  before update on public.profiles
  for each row execute function private.profiles_location_before_update();

-- -----------------------------------------------------------------------------
-- Şehir arama (başlangıç soruları ve profil düzenleme)
-- -----------------------------------------------------------------------------
-- Ada ya da bir diğer adına göre başlayanlar önce, sonra nüfusa göre.
create or replace function public.search_cities(p_country text, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_query text := private.geo_fold(left(coalesce(p_query, ''), 60));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_country !~ '^[A-Z]{2}$' or char_length(v_query) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'region', s.region)
                     order by s.rank, s.inhabitants desc, s.name)
    from (
      select c.id, c.name, c.region, c.inhabitants,
        case when position('|' || v_query in c.search) > 0 then 0 else 1 end as rank
      from public.world_cities c
      where c.country_code = v_country
        and position(v_query in c.search) > 0
      order by rank, c.inhabitants desc, c.name
      limit 8
    ) s
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.search_cities(text, text) from public, anon;
grant execute on function public.search_cities(text, text) to authenticated;
revoke execute on function private.geo_fold(text) from public, anon, authenticated;
revoke execute on function private.tr_cities() from public, anon, authenticated;
revoke execute on function private.profiles_location_before_update() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Profil kartı: ülke kodu da döner
-- -----------------------------------------------------------------------------
create or replace function private.profile_card(p_target uuid, p_viewer uuid)
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
    'age', case when p.show_age or p.id = p_viewer then private.age_years(pp.birth_date) end,
    'gender', case when (p.show_gender or p.id = p_viewer) and p.gender <> 'unspecified' then p.gender end,
    'city', p.city,
    'country_code', p.country_code,
    'district', case when p.show_district or p.id = p_viewer then p.district end,
    'occupation', p.occupation,
    'bio', p.bio,
    'languages', to_jsonb(p.languages),
    'looking_for', to_jsonb(
      case
        when p.id = p_viewer or private.flirt_compatible(p.id, p_viewer) then p.looking_for
        else array_remove(p.looking_for, 'flirt')
      end
    ),
    'is_online', private.is_online(p.show_online, p.last_seen_at),
    'member_since', date_trunc('month', p.created_at),
    'photo_path', private.current_photo_path(p.id),
    'common_hobby_count', case when p.id = p_viewer then 0 else private.common_hobby_count(p.id, p_viewer) end,
    'hobbies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', h.slug,
          'name_tr', h.name_tr,
          'name_en', h.name_en,
          'common', p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v where v.profile_id = p_viewer and v.hobby_id = h.id
          )
        )
        order by
          (p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v where v.profile_id = p_viewer and v.hobby_id = h.id
          )) desc,
          h.name_tr
      )
      from public.profile_hobbies ph
      join public.hobbies h on h.id = ph.hobby_id
      where ph.profile_id = p.id
    ), '[]'::jsonb)
  )
  from public.profiles p
  join public.profile_private pp on pp.id = p.id
  where p.id = p_target
$$;

-- -----------------------------------------------------------------------------
-- Keşfet: "Yakınımdakiler" aynı ülke + aynı şehir (city_key)
-- -----------------------------------------------------------------------------
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
  if v_search is not null and char_length(v_search) > 50 then
    v_search := left(v_search, 50);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  p_offset := least(greatest(coalesce(p_offset, 0), 0), 10000);

  select city_key, lower(district) into v_me_city_key, v_me_district
  from public.profiles where id = v_me;

  with candidates as (
    select
      p.id, p.city, p.city_key, p.district, p.show_district, p.show_age, p.created_at, p.last_seen_at,
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
-- Yönetim paneli kullanıcı detayı: ülke kodu da döner
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_email text;
  v_email_confirmed_at timestamptz;
begin
  perform private.admin_audit('user.view', 'user', p_user::text);
  select * into p from public.profiles where id = p_user;
  if not found then
    return null;
  end if;
  select u.email, u.email_confirmed_at into v_email, v_email_confirmed_at from auth.users u where u.id = p_user;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'email', v_email, 'email_confirmed_at', v_email_confirmed_at,
      'birth_date', (select pp.birth_date from public.profile_private pp where pp.id = p.id),
      'gender', p.gender, 'city', p.city, 'country_code', p.country_code, 'district', p.district, 'occupation', p.occupation, 'bio', p.bio,
      'looking_for', to_jsonb(p.looking_for), 'languages', to_jsonb(p.languages),
      'hobbies', (
        select coalesce(jsonb_agg(jsonb_build_object('tr', h.name_tr, 'en', h.name_en) order by h.name_tr), '[]'::jsonb)
        from public.profile_hobbies ph join public.hobbies h on h.id = ph.hobby_id
        where ph.profile_id = p.id
      ),
      'account_status', p.account_status, 'status_reason', p.status_reason,
      'suspended_until', p.suspended_until, 'status_changed_at', p.status_changed_at,
      'created_at', p.created_at, 'last_seen_at', p.last_seen_at,
      'onboarding_completed_at', p.onboarding_completed_at,
      'deleted_at', p.deleted_at, 'is_test', p.is_test
    ),
    'stats', jsonb_build_object(
      'conversations', (select count(*) from public.conversations c where c.user_a = p.id or c.user_b = p.id),
      'messages_sent', (select count(*) from public.messages m where m.sender_id = p.id),
      'blocked_by', (select count(*) from public.blocks b where b.blocked_id = p.id),
      'blocks_made', (select count(*) from public.blocks b where b.blocker_id = p.id)
    ),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ph.id, 'storage_path', ph.storage_path, 'status', ph.status, 'created_at', ph.created_at,
        'is_current', ph.id = p.photo_id) order by ph.created_at desc), '[]'::jsonb)
      from public.profile_photos ph where ph.user_id = p.id
    ),
    'reports_against', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
        'is_anonymous', r.anon_conversation_id is not null,
        'other', private.admin_user_brief(r.reporter_id)) order by r.created_at desc), '[]'::jsonb)
      from public.reports r where r.reported_id = p.id
    ),
    'reports_filed', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
        'is_anonymous', r.anon_conversation_id is not null,
        'other', private.admin_user_brief(r.reported_id)) order by r.created_at desc), '[]'::jsonb)
      from public.reports r where r.reporter_id = p.id
    ),
    'appeals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'account_status', a.account_status, 'message', a.message,
        'created_at', a.created_at, 'reviewed_at', a.reviewed_at) order by a.created_at desc), '[]'::jsonb)
      from public.appeals a where a.user_id = p.id
    ),
    'age_documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'status', d.status, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at,
        'review_note', d.review_note) order by d.created_at desc), '[]'::jsonb)
      from private.age_documents d where d.user_id = p.id
    ),
    -- Bu kişiye ya da onun fotoğraf/itiraz/belge/şikâyetlerine yapılmış yönetici
    -- işlemleri (görüntülemeler hariç), en yeni 50 tanesi.
    'admin_history', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.id desc), '[]'::jsonb)
      from (
        select l.id, l.action, l.target_type, l.details, l.created_at, ap.username as admin_username
        from private.admin_audit_log l
        left join public.profiles ap on ap.id = l.admin_id
        where l.action not like '%.view'
          and (
            (l.target_type = 'user' and l.target_id = p.id::text)
            or (l.target_type = 'photo' and l.target_id in (select ph.id::text from public.profile_photos ph where ph.user_id = p.id))
            or (l.target_type = 'appeal' and l.target_id in (select a.id::text from public.appeals a where a.user_id = p.id))
            or (l.target_type = 'age_document' and l.target_id in (select d.id::text from private.age_documents d where d.user_id = p.id))
            or (l.target_type = 'report' and l.target_id in (select r.id::text from public.reports r where r.reported_id = p.id))
          )
        order by l.id desc
        limit 50
      ) x
    )
  );
end;
$$;
