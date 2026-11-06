-- =============================================================================
-- Sohby — 1/3: Profiller ve hobiler
-- =============================================================================
-- Güvenlik ilkeleri (tüm migration'lar için geçerli):
--  * Her tabloda RLS açık. Supabase'in public şemasında anon/authenticated'a
--    varsayılan olarak verdiği TÜM yetkiler geri alınır; yalnızca gerekenler
--    sütun bazında tek tek verilir.
--  * Başka kullanıcıların profil satırları tablodan doğrudan OKUNAMAZ. Diğer
--    kişilerin bilgileri yalnızca gizlilik ayarlarını uygulayan SECURITY DEFINER
--    fonksiyonlar üzerinden döner (bkz. private.profile_card).
--  * Doğum tarihi ayrı bir tabloda (profile_private) tutulur ve yalnızca sahibi
--    görür. Başkalarına yalnızca yaş (ve o da kullanıcı izin verirse) gösterilir.
--  * 18 yaş altı kayıt veritabanı seviyesinde de engellenir.
--  * SECURITY DEFINER fonksiyonların hepsinde `search_path = ''` ve tam nitelikli
--    adlar kullanılır; EXECUTE yetkisi PUBLIC/anon'dan geri alınır.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- RLS politikalarında çağrılan birkaç yardımcı fonksiyon için gerekli.
-- `private` şeması PostgREST API'sine açık değildir.
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Yardımcılar
-- -----------------------------------------------------------------------------

-- Türkiye saatine göre bugünün tarihi (yaş hesapları için).
create or replace function private.today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Istanbul')::date
$$;

create or replace function private.age_years(p_birth_date date)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when p_birth_date is null then null
    else extract(year from age(private.today(), p_birth_date))::integer
  end
$$;

create or replace function private.is_adult_birth_date(p_birth_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_birth_date is not null
     and p_birth_date <= (private.today() - interval '18 years')::date
     and p_birth_date >= date '1900-01-01'
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: herkese (koşullu) gösterilebilecek profil bilgileri + gizlilik ayarları
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  gender text not null default 'unspecified'
    check (gender in ('female', 'male', 'other', 'unspecified')),
  city text check (city is null or char_length(btrim(city)) between 1 and 60),
  district text check (district is null or char_length(btrim(district)) between 1 and 60),
  occupation text check (occupation is null or char_length(occupation) <= 80),
  bio text check (bio is null or char_length(bio) <= 500),

  -- Başlangıç sorusu: "Sohby'de ne arıyorsun?"
  looking_for text[] not null default '{}'
    check (looking_for <@ array[
      'chat', 'friends', 'hobby_buddy', 'activity', 'flirt',
      'new_in_town', 'language_practice'
    ]::text[]),
  -- Flört seçildiyse: kimlerle ilgilendiği. Kimseye doğrudan gösterilmez.
  dating_interest text[] not null default '{}'
    check (dating_interest <@ array['female', 'male', 'other']::text[]),
  languages text[] not null default '{}'
    check (
      cardinality(languages) <= 10
      and languages <@ array[
        'tr', 'en', 'de', 'fr', 'es', 'it', 'ru', 'ar', 'ku', 'az',
        'fa', 'nl', 'pt', 'ja', 'ko', 'zh', 'el', 'bg'
      ]::text[]
    ),

  -- Gizlilik ayarları (tasarim/11-ayarlar-gizlilik.png). Varsayılanlar korumacı.
  show_in_discover boolean not null default true,
  show_age boolean not null default true,
  show_district boolean not null default true,
  show_gender boolean not null default true,
  show_online boolean not null default false,
  message_policy text not null default 'request_first'
    check (message_policy in ('everyone', 'request_first', 'common_hobby')),

  last_seen_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Kullanıcı profili. Yalnızca sahibi doğrudan okuyabilir; diğerleri private.profile_card ile filtrelenmiş görür.';

create index profiles_city_idx on public.profiles (lower(city));
create index profiles_last_seen_idx on public.profiles (last_seen_at desc);

-- -----------------------------------------------------------------------------
-- profile_private: yalnızca sahibinin gördüğü hassas bilgiler
-- -----------------------------------------------------------------------------
create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  birth_date date,
  -- 18 yaş altı doğum tarihi girildiyse işaretlenir; sonrasında tarih girilemez.
  age_check_failed_at timestamptz,
  -- KVKK açık rıza: flört (özel nitelikli veri sayılabilecek tercih) için.
  dating_consent_at timestamptz,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- 18 yaş kuralı CHECK yerine SECURITY DEFINER tetikleyicilerde uygulanır
  -- (CHECK, çağıran rolün yetkisiyle çalışır ve private şemasına erişemez).
);

comment on table public.profile_private is
  'Doğum tarihi ve rıza kayıtları. Yalnızca sahibi okuyabilir.';

-- -----------------------------------------------------------------------------
-- hobbies: sabit katalog (serbest metin yok → kötüye kullanım/hakaret önlenir)
-- -----------------------------------------------------------------------------
create table public.hobbies (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9_]{2,40}$'),
  name_tr text not null check (char_length(name_tr) between 1 and 40),
  name_en text not null check (char_length(name_en) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.profile_hobbies (
  profile_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  hobby_id smallint not null references public.hobbies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, hobby_id)
);

create index profile_hobbies_hobby_idx on public.profile_hobbies (hobby_id);

insert into public.hobbies (slug, name_tr, name_en) values
  ('chess', 'Satranç', 'Chess'),
  ('music', 'Müzik', 'Music'),
  ('cinema', 'Sinema', 'Cinema'),
  ('books', 'Kitap', 'Books'),
  ('photography', 'Fotoğraf', 'Photography'),
  ('basketball', 'Basketbol', 'Basketball'),
  ('football', 'Futbol', 'Football'),
  ('volleyball', 'Voleybol', 'Volleyball'),
  ('tennis', 'Tenis', 'Tennis'),
  ('running', 'Koşu', 'Running'),
  ('walking', 'Yürüyüş', 'Walking'),
  ('hiking', 'Doğa yürüyüşü', 'Hiking'),
  ('cycling', 'Bisiklet', 'Cycling'),
  ('swimming', 'Yüzme', 'Swimming'),
  ('yoga', 'Yoga', 'Yoga'),
  ('fitness', 'Fitness', 'Fitness'),
  ('dance', 'Dans', 'Dance'),
  ('games', 'Oyun', 'Gaming'),
  ('board_games', 'Kutu oyunları', 'Board games'),
  ('coding', 'Kodlama', 'Coding'),
  ('cooking', 'Yemek', 'Cooking'),
  ('coffee', 'Kahve', 'Coffee'),
  ('travel', 'Seyahat', 'Travel'),
  ('camping', 'Kamp', 'Camping'),
  ('painting', 'Resim', 'Painting'),
  ('drawing', 'Çizim', 'Drawing'),
  ('crafts', 'El işi', 'Crafts'),
  ('theatre', 'Tiyatro', 'Theatre'),
  ('concerts', 'Konser', 'Concerts'),
  ('guitar', 'Gitar', 'Guitar'),
  ('piano', 'Piyano', 'Piano'),
  ('singing', 'Şarkı söylemek', 'Singing'),
  ('languages', 'Yabancı dil', 'Languages'),
  ('writing', 'Yazmak', 'Writing'),
  ('podcasts', 'Podcast', 'Podcasts'),
  ('anime', 'Anime', 'Anime'),
  ('series', 'Dizi', 'TV series'),
  ('pets', 'Evcil hayvanlar', 'Pets'),
  ('gardening', 'Bahçecilik', 'Gardening'),
  ('fishing', 'Balık tutma', 'Fishing'),
  ('volunteering', 'Gönüllülük', 'Volunteering'),
  ('meditation', 'Meditasyon', 'Meditation'),
  ('fashion', 'Moda', 'Fashion'),
  ('technology', 'Teknoloji', 'Technology'),
  ('science', 'Bilim', 'Science'),
  ('history', 'Tarih', 'History'),
  ('climbing', 'Tırmanış', 'Climbing'),
  ('skiing', 'Kayak', 'Skiing');

-- -----------------------------------------------------------------------------
-- Yeni kullanıcı → profil oluşturma (auth.users tetikleyicisi)
-- -----------------------------------------------------------------------------
-- Kayıt formundan gelen user_metadata: username, birth_date (YYYY-MM-DD),
-- gender, terms_accepted. Google ile girişte bunlar gelmez; eksikler başlangıç
-- sorularında tamamlanır ve tamamlanmadan hiçbir sosyal özellik açılmaz.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_username text;
  v_birth_date date;
  v_gender text;
  v_terms boolean := coalesce((v_meta ->> 'terms_accepted')::boolean, false);
begin
  -- Kullanıcı adı: verildiyse doğrulanır, verilmediyse (Google) rastgele üretilir.
  if v_meta ? 'username' then
    v_username := lower(btrim(v_meta ->> 'username'));
    if v_username !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'invalid_username' using errcode = '22023';
    end if;
  else
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  -- Doğum tarihi: verildiyse 18 yaş kontrolü burada da yapılır.
  if v_meta ? 'birth_date' then
    begin
      v_birth_date := (v_meta ->> 'birth_date')::date;
    exception when others then
      raise exception 'invalid_birth_date' using errcode = '22023';
    end;
    if not private.is_adult_birth_date(v_birth_date) then
      raise exception 'underage' using errcode = '22023';
    end if;
  end if;

  v_gender := coalesce(v_meta ->> 'gender', 'unspecified');
  if v_gender not in ('female', 'male', 'other', 'unspecified') then
    v_gender := 'unspecified';
  end if;

  insert into public.profiles (id, username, gender)
  values (new.id, v_username, v_gender);

  insert into public.profile_private (id, birth_date, terms_accepted_at)
  values (new.id, v_birth_date, case when v_terms then now() end);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Profil iş kuralları
-- -----------------------------------------------------------------------------
create or replace function private.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_private public.profile_private%rowtype;
begin
  new.username := lower(btrim(new.username));
  new.display_name := nullif(btrim(new.display_name), '');
  new.city := nullif(btrim(new.city), '');
  new.district := nullif(btrim(new.district), '');
  new.occupation := nullif(btrim(new.occupation), '');
  new.bio := nullif(btrim(new.bio), '');

  -- Diziler: tekrarları kaldır.
  new.looking_for := array(select distinct unnest(new.looking_for));
  new.languages := array(select distinct unnest(new.languages));
  new.dating_interest := array(select distinct unnest(new.dating_interest));

  select * into v_private from public.profile_private where id = new.id;

  if 'flirt' = any (new.looking_for) then
    -- Flört yalnızca açık rıza + ilgi tercihi ile seçilebilir.
    if v_private.dating_consent_at is null then
      raise exception 'dating_consent_required' using errcode = '22023';
    end if;
    if cardinality(new.dating_interest) = 0 then
      raise exception 'dating_interest_required' using errcode = '22023';
    end if;
  else
    -- Flört bırakıldıysa ilgi tercihi silinir ve rıza geri çekilmiş sayılır.
    new.dating_interest := '{}';
    if v_private.dating_consent_at is not null
       and current_setting('sohby.syncing_flirt', true) is distinct from 'on' then
      -- Karşı tetikleyicinin bu satırı tekrar güncellemesini engelle.
      perform set_config('sohby.syncing_flirt', 'on', true);
      update public.profile_private set dating_consent_at = null where id = new.id;
      perform set_config('sohby.syncing_flirt', 'off', true);
    end if;
  end if;

  -- Başlangıç soruları tamamlanıyor: zorunlu alanlar.
  if new.onboarding_completed_at is not null and old.onboarding_completed_at is null then
    if new.display_name is null then
      raise exception 'display_name_required' using errcode = '22023';
    end if;
    if new.city is null then
      raise exception 'city_required' using errcode = '22023';
    end if;
    if cardinality(new.looking_for) = 0 then
      raise exception 'looking_for_required' using errcode = '22023';
    end if;
    if not private.is_adult_birth_date(v_private.birth_date) then
      raise exception 'birth_date_required' using errcode = '22023';
    end if;
    if v_private.terms_accepted_at is null then
      raise exception 'terms_required' using errcode = '22023';
    end if;
    new.onboarding_completed_at := now();
  elsif old.onboarding_completed_at is not null then
    -- Tamamlanma zamanı geri alınamaz/değiştirilemez.
    new.onboarding_completed_at := old.onboarding_completed_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function private.profiles_before_update();

create or replace function private.profile_private_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Doğum tarihi yalnızca public.set_birth_date() ile ve bir kez girilebilir.
  if new.birth_date is distinct from old.birth_date
     and current_setting('sohby.allow_birth_date', true) is distinct from 'on' then
    raise exception 'birth_date_immutable' using errcode = '42501';
  end if;
  if new.birth_date is not null and not private.is_adult_birth_date(new.birth_date) then
    raise exception 'underage' using errcode = '22023';
  end if;
  new.age_check_failed_at := coalesce(old.age_check_failed_at, new.age_check_failed_at);

  -- Rıza zaman damgaları istemciden gelen değerle değil, sunucu saatiyle yazılır.
  if new.dating_consent_at is not null then
    new.dating_consent_at := coalesce(old.dating_consent_at, now());
  end if;
  if new.terms_accepted_at is null then
    new.terms_accepted_at := old.terms_accepted_at; -- geri alınamaz
  else
    new.terms_accepted_at := coalesce(old.terms_accepted_at, now());
  end if;

  -- Rıza geri çekildiyse flört tercihi kaldırılır.
  if new.dating_consent_at is null and old.dating_consent_at is not null
     and current_setting('sohby.syncing_flirt', true) is distinct from 'on' then
    perform set_config('sohby.syncing_flirt', 'on', true);
    update public.profiles
      set looking_for = array_remove(looking_for, 'flirt')
      where id = new.id and 'flirt' = any (looking_for);
    perform set_config('sohby.syncing_flirt', 'off', true);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger profile_private_before_update
  before update on public.profile_private
  for each row execute function private.profile_private_before_update();

-- Hobi sayısı sınırı.
create or replace function private.profile_hobbies_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.profile_hobbies where profile_id = new.profile_id) >= 15 then
    raise exception 'too_many_hobbies' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profile_hobbies_limit
  before insert on public.profile_hobbies
  for each row execute function private.profile_hobbies_limit();

-- -----------------------------------------------------------------------------
-- Profil yardımcıları (gizlilik kurallarının tek kaynağı)
-- -----------------------------------------------------------------------------

-- Başlangıç sorularını bitirmiş, yetişkin ve aktif kullanıcı mı?
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
      and private.is_adult_birth_date(pp.birth_date)
  )
$$;

create or replace function private.is_online(p_show_online boolean, p_last_seen timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_show_online and p_last_seen > now() - interval '5 minutes', false)
$$;

-- İki kullanıcı karşılıklı olarak flörtle ilgileniyor ve birbirlerinin
-- cinsiyet tercihine uyuyor mu? Uymuyorsa "flört" etiketi gösterilmez.
create or replace function private.flirt_compatible(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles a
    join public.profile_private ap on ap.id = a.id
    join public.profiles b on b.id = p_b
    join public.profile_private bp on bp.id = b.id
    where a.id = p_a
      and a.id <> b.id
      and 'flirt' = any (a.looking_for) and ap.dating_consent_at is not null
      and 'flirt' = any (b.looking_for) and bp.dating_consent_at is not null
      and b.gender = any (a.dating_interest)
      and a.gender = any (b.dating_interest)
  )
$$;

create or replace function private.common_hobby_count(p_a uuid, p_b uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profile_hobbies x
  join public.profile_hobbies y on y.hobby_id = x.hobby_id and y.profile_id = p_b
  where x.profile_id = p_a
$$;

-- Bir profilin, izleyen kişiye gösterilecek hâli. Gizlilik ayarları burada
-- uygulanır: kapalı alanlar null döner, flört etiketi yalnızca uyumlu
-- kişilere görünür, doğum tarihi asla dönmez.
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
    'common_hobby_count', case when p.id = p_viewer then 0 else private.common_hobby_count(p.id, p_viewer) end,
    'hobbies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', h.slug,
          'name_tr', h.name_tr,
          'name_en', h.name_en,
          'common', p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v
            where v.profile_id = p_viewer and v.hobby_id = h.id
          )
        )
        order by
          (p.id <> p_viewer and exists (
            select 1 from public.profile_hobbies v
            where v.profile_id = p_viewer and v.hobby_id = h.id
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
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.hobbies enable row level security;
alter table public.profile_hobbies enable row level security;

revoke all on public.profiles, public.profile_private, public.hobbies, public.profile_hobbies
  from public, anon, authenticated;

-- profiles: yalnızca kendi satırını okur/günceller. Ekleme tetikleyiciyle,
-- silme hesap silme ile (auth.users cascade) yapılır.
grant select on public.profiles to authenticated;
grant update (
  username, display_name, gender, city, district, occupation, bio,
  looking_for, dating_interest, languages,
  show_in_discover, show_age, show_district, show_gender, show_online,
  message_policy, onboarding_completed_at
) on public.profiles to authenticated;

create policy "profiles: kendi satırını okur"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: kendi satırını günceller"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- profile_private: yalnızca sahibi okur. Doğum tarihi doğrudan güncellenemez
-- (set_birth_date RPC). Rıza alanları sahibi tarafından güncellenebilir.
grant select on public.profile_private to authenticated;
grant update (dating_consent_at, terms_accepted_at) on public.profile_private to authenticated;

create policy "profile_private: kendi satırını okur"
  on public.profile_private for select to authenticated
  using (id = (select auth.uid()));

create policy "profile_private: kendi satırını günceller"
  on public.profile_private for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- hobbies: katalog herkese açık, yalnızca okunur.
grant select on public.hobbies to anon, authenticated;

create policy "hobbies: herkes okur"
  on public.hobbies for select to anon, authenticated
  using (true);

-- profile_hobbies: yalnızca kendi hobilerini görür/ekler/siler. Başkalarının
-- hobileri profile_card üzerinden gelir.
grant select, delete on public.profile_hobbies to authenticated;
grant insert (profile_id, hobby_id) on public.profile_hobbies to authenticated;

create policy "profile_hobbies: kendi hobilerini okur"
  on public.profile_hobbies for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "profile_hobbies: kendine hobi ekler"
  on public.profile_hobbies for insert to authenticated
  with check (profile_id = (select auth.uid()));

create policy "profile_hobbies: kendi hobisini siler"
  on public.profile_hobbies for delete to authenticated
  using (profile_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- RPC'ler (API'ye açık)
-- -----------------------------------------------------------------------------

-- Kayıt formunda kullanıcı adı müsait mi? (Kullanıcı adları zaten herkese
-- açık profil bilgisidir; e-posta vb. hiçbir şey sızdırmaz.)
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_username)) ~ '^[a-z0-9_]{3,20}$'
     and not exists (
       select 1 from public.profiles where username = lower(btrim(p_username))
     )
$$;

-- Doğum tarihi girişi (Google ile kayıt olanlar için). Bir kez girilebilir.
-- 18 yaş altı girilirse hesap kalıcı olarak işaretlenir ve tekrar denenemez.
create or replace function public.set_birth_date(p_birth_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.profile_private%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_row from public.profile_private where id = v_me for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.age_check_failed_at is not null then
    return 'underage';
  end if;
  if v_row.birth_date is not null then
    return 'already_set';
  end if;
  if p_birth_date is null or p_birth_date > private.today() or p_birth_date < date '1900-01-01' then
    return 'invalid';
  end if;
  if not private.is_adult_birth_date(p_birth_date) then
    update public.profile_private set age_check_failed_at = now() where id = v_me;
    return 'underage';
  end if;

  perform set_config('sohby.allow_birth_date', 'on', true);
  update public.profile_private set birth_date = p_birth_date where id = v_me;
  perform set_config('sohby.allow_birth_date', 'off', true);
  return 'ok';
end;
$$;

-- Çevrimiçi bilgisini tazeler (istemci birkaç dakikada bir çağırır).
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '60 seconds')
$$;
