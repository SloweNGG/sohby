-- =============================================================================
-- Sohby — 5: Veri saklama (90 gün) ve 18 yaş altı hesapların silinmesi
-- =============================================================================
-- Kararlar (GECE_RAPORU.md):
--  * Mesaj saklama süresi 90 gün. Silinen hesapların mesajları 90 gün sonra
--    kalıcı olarak silinir. (Kendi görünümünden silinen sohbetler sohbet silme
--    adımında bu fonksiyona eklenir.)
--  * Şikâyet edilmiş sohbetlerin mesajları şikâyet kapanana kadar saklanır.
--  * 18 yaş altı Google kaydı hemen kilitlenir ve 24 saat içinde tamamen silinir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hesap silme (kapatma) işareti
-- -----------------------------------------------------------------------------
alter table public.profiles add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Hesap silindi (kapatıldı). Hesap hemen görünmez ve kullanılamaz olur; veriler 90 gün sonra kalıcı silinir.';

-- Aktif kullanıcı: başlangıcı bitmiş, yetişkin ve silinmemiş.
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
  )
$$;

-- Keşfet aday listesi aktif kullanıcıları doğrudan süzüyordu; silinmiş hesaplar da çıkarılır.
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

-- Kullanıcının kendi hesabını silmesi: hemen kapanır, veriler 90 gün sonra silinir.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.profiles
     set deleted_at = coalesce(deleted_at, now()), show_in_discover = false, show_online = false
   where id = auth.uid();
  -- Özel nitelikli veri (flört tercihi) beklemeden silinir.
  delete from private.dating_preferences where user_id = auth.uid();
  -- Bekleyen istekler kapanır.
  update public.message_requests
     set status = 'declined', responded_at = now()
   where status = 'pending' and (sender_id = auth.uid() or recipient_id = auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Şikâyet koruması: açık şikâyetle ilişkili sohbet/istek/kişi silinmez.
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
        or exists (
          select 1 from public.conversations c
          where c.id = r.conversation_id and p_user in (c.user_a, c.user_b)
        )
        or exists (
          select 1 from public.message_requests mr
          where mr.id = r.message_request_id and p_user in (mr.sender_id, mr.recipient_id)
        )
      )
  )
$$;

-- -----------------------------------------------------------------------------
-- 18 yaş altı hesaplar: kilitlendikten sonra en geç 24 saat içinde silinir
-- (saatlik görev). Bu hesaplar başlangıcı bitiremediği için mesajları yoktur.
-- -----------------------------------------------------------------------------
create or replace function private.purge_underage_accounts()
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
    select id from public.profile_private where age_check_failed_at is not null
  loop
    begin
      delete from auth.users where id = v_id;
      v_count := v_count + 1;
    exception when others then
      -- Bir hesap silinemezse (ör. beklenmedik bağlı kayıt) diğerleri etkilenmesin.
      raise warning 'purge_underage_accounts: % silinemedi: %', v_id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- Edge Function (purge-underage-accounts) için: silinecek hesapların listesi.
-- Yalnızca service_role çağırabilir.
create or replace function public.underage_accounts_due()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profile_private where age_check_failed_at is not null
$$;

-- -----------------------------------------------------------------------------
-- 90 günlük saklama: silinmiş hesapların verileri kalıcı olarak temizlenir.
-- Açık şikâyetle ilişkili hesaplar şikâyet kapanana kadar beklenir.
-- -----------------------------------------------------------------------------
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
    select id from public.profiles
    where deleted_at is not null and deleted_at < now() - interval '90 days'
  loop
    if private.has_open_report_involving(v_id) then
      continue;
    end if;
    begin
      delete from public.messages m
        using public.conversations c
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

-- Günlük temizlik görevinin giriş noktası (sonraki adımlar buraya ekler).
create or replace function private.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'underage', private.purge_underage_accounts(),
    'deleted_accounts', private.purge_deleted_accounts()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Zamanlanmış görevler (pg_cron). Yerel test ortamında pg_cron yoksa atlanır.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sohby-purge-underage', '7 * * * *', 'select private.purge_underage_accounts()');
    perform cron.schedule('sohby-purge-expired', '23 3 * * *', 'select private.purge_expired_data()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function private.can_send_message(uuid) to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
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
grant execute on function public.set_dating_preferences(text[]) to authenticated;
grant execute on function public.withdraw_dating_consent() to authenticated;
grant execute on function public.has_dating_consent() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.underage_accounts_due() to service_role;
