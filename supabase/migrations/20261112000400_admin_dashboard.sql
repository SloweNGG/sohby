-- =============================================================================
-- Sohby — Yönetim paneli: grafikli genel bakış
-- =============================================================================
-- * `admin_dashboard(p_days)` seçilen dönem (7, 30 ya da 90 gün) için panelin
--   ana ekranındaki her şeyi TEK çağrıda döndürür:
--     - günlük seriler: yeni kayıt, mesaj, mesaj yazan kişi, yeni sohbet, şikâyet
--     - dönem toplamları ve bir önceki eşit dönemle karşılaştırma
--     - anlık durum: kullanıcı, son 7 gün aktif, şu an çevrimiçi, doğrulanmış öğrenci
--     - kayıttan sohbete adımlar (bu dönemde kayıt olanlar)
--     - 1 hafta sonra geri gelme oranı
--     - kitle: ne arıyor, cinsiyet, yaş aralığı, en çok kullanıcı olan şehirler
--     - mesaj istekleri (kabul / ret), içerik türleri, arkadaşlıklar
--     - bekleyen işler ve en eskisinin ne zamandır beklediği; şikâyet nedenleri
-- * YALNIZCA toplam sayılar döner: kişi, kimlik, mesaj içeriği yoktur. Flört
--   tercihi (kural 11) hiç okunmaz.
-- * Ekranın açılması işlem kaydına yazılır (overview.view, dönem bilgisiyle).
-- * Günler Türkiye saatine göredir. Test hesapları (is_test) hiçbir sayıya girmez.
-- =============================================================================

create or replace function public.admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days constant integer := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_tz constant text := 'Europe/Istanbul';
  v_today constant date := (now() at time zone 'Europe/Istanbul')::date;
  v_first constant date := v_today - (v_days - 1);
  v_start constant timestamptz := v_first::timestamp at time zone 'Europe/Istanbul';
  v_prev_start constant timestamptz := (v_first - v_days)::timestamp at time zone 'Europe/Istanbul';
  v_series jsonb;
  v_totals jsonb;
  v_previous jsonb;
begin
  perform private.admin_audit('overview.view', null, null, jsonb_build_object('days', v_days));

  -- Olaylar (önceki dönemin başından bugüne), test hesapları hariç.
  -- Aynı işlemde ikinci çağrı için önce kaldırılır.
  drop table if exists pg_temp.dash_events;
  create temp table dash_events (kind text, at timestamptz, uid uuid) on commit drop;

  insert into pg_temp.dash_events
  select 'signup', p.created_at, p.id
    from public.profiles p
   where p.created_at >= v_prev_start and not p.is_test;

  -- Mesajlar: normal sohbet + anonim sohbet + henüz kabul edilmemiş isteklerin ilk mesajı
  -- (kabul edilen isteğin mesajı sohbete kopyalanır; iki kez sayılmasın).
  insert into pg_temp.dash_events
  select 'message', m.created_at, m.sender_id
    from public.messages m
    join public.profiles p on p.id = m.sender_id
   where m.created_at >= v_prev_start and not p.is_test;

  insert into pg_temp.dash_events
  select 'message', am.created_at, case when am.from_anonymous then s.sender_id else s.recipient_id end
    from public.anon_messages am
    join private.anon_senders s on s.conversation_id = am.conversation_id
    join public.profiles p on p.id = s.recipient_id
   where am.created_at >= v_prev_start and not p.is_test;

  insert into pg_temp.dash_events
  select 'message', r.created_at, r.sender_id
    from public.message_requests r
    join public.profiles p on p.id = r.sender_id
   where r.created_at >= v_prev_start and r.status <> 'accepted' and not p.is_test;

  insert into pg_temp.dash_events
  select 'conversation', c.created_at, null
    from public.conversations c
    join public.profiles p on p.id = c.user_a
   where c.created_at >= v_prev_start and not p.is_test;

  insert into pg_temp.dash_events
  select 'conversation', a.created_at, null
    from public.anon_conversations a
    join public.profiles p on p.id = a.recipient_id
   where a.created_at >= v_prev_start and not p.is_test;

  insert into pg_temp.dash_events
  select 'report', r.created_at, null
    from public.reports r
    left join public.profiles p on p.id = r.reporter_id
   where r.created_at >= v_prev_start and not coalesce(p.is_test, false);

  -- Günlük seriler (boş günler 0).
  select jsonb_agg(jsonb_build_object(
           'day', d.day,
           'signups', coalesce(e.signups, 0),
           'messages', coalesce(e.messages, 0),
           'active', coalesce(e.active, 0),
           'conversations', coalesce(e.conversations, 0),
           'reports', coalesce(e.reports, 0)
         ) order by d.day)
    into v_series
    from (select g::date as day from generate_series(v_first, v_today, interval '1 day') g) d
    left join (
      select (at at time zone v_tz)::date as day,
             count(*) filter (where kind = 'signup') as signups,
             count(*) filter (where kind = 'message') as messages,
             count(distinct uid) filter (where kind = 'message') as active,
             count(*) filter (where kind = 'conversation') as conversations,
             count(*) filter (where kind = 'report') as reports
        from pg_temp.dash_events
       where at >= v_start
       group by 1
    ) e on e.day = d.day;

  select jsonb_build_object(
           'signups', count(*) filter (where kind = 'signup'),
           'messages', count(*) filter (where kind = 'message'),
           'active', count(distinct uid) filter (where kind = 'message'),
           'conversations', count(*) filter (where kind = 'conversation'),
           'reports', count(*) filter (where kind = 'report'))
    into v_totals
    from pg_temp.dash_events where at >= v_start;

  select jsonb_build_object(
           'signups', count(*) filter (where kind = 'signup'),
           'messages', count(*) filter (where kind = 'message'),
           'active', count(distinct uid) filter (where kind = 'message'),
           'conversations', count(*) filter (where kind = 'conversation'),
           'reports', count(*) filter (where kind = 'report'))
    into v_previous
    from pg_temp.dash_events where at >= v_prev_start and at < v_start;

  return jsonb_build_object(
    'days', v_days,
    'from', v_first,
    'to', v_today,
    'series', v_series,
    'totals', v_totals,
    'previous', v_previous,

    'now', (
      select jsonb_build_object(
        'users', count(*),
        'active_7d', count(*) filter (where p.last_seen_at >= now() - interval '7 days'),
        'online', count(*) filter (where p.last_seen_at > now() - interval '5 minutes'),
        'students', count(*) filter (where p.student_verified_until > now()),
        'suspended', count(*) filter (where p.account_status = 'suspended'),
        'closed', count(*) filter (where p.account_status = 'closed'),
        'age_verification_required', count(*) filter (where p.account_status = 'age_verification_required'),
        'friendships', (select count(*) from public.friendships f
                         join public.profiles fp on fp.id = f.user_a where not fp.is_test)
      )
      from public.profiles p
      where p.deleted_at is null and not p.is_test
    ),

    -- Bu dönemde kayıt olanlar: kaçı hangi adıma geldi?
    'funnel', (
      select jsonb_build_object(
        'signed_up', count(*),
        'email_verified', count(*) filter (where u.email_confirmed_at is not null),
        'onboarded', count(*) filter (where p.onboarding_completed_at is not null),
        'messaged', count(*) filter (where
          exists (select 1 from public.messages m where m.sender_id = p.id)
          or exists (select 1 from public.message_requests r where r.sender_id = p.id)
          or exists (select 1 from private.anon_senders s
                      join public.anon_messages am on am.conversation_id = s.conversation_id and am.from_anonymous
                     where s.sender_id = p.id)),
        'mutual', count(*) filter (where exists (
          select 1 from public.conversations c
           where p.id in (c.user_a, c.user_b)
             and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = p.id)
             and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id <> p.id)))
      )
      from public.profiles p
      left join auth.users u on u.id = p.id
      where p.created_at >= v_start and not p.is_test
    ),

    -- Bu dönemden bir hafta önce başlayan pencerede kayıt olanların kaçı,
    -- kayıttan en az 7 gün sonra yeniden geldi?
    'retention', (
      select jsonb_build_object(
        'eligible', count(*),
        'returned', count(*) filter (where p.last_seen_at >= p.created_at + interval '7 days')
      )
      from public.profiles p
      where p.created_at >= v_start - interval '7 days'
        and p.created_at < now() - interval '7 days'
        and not p.is_test
    ),

    'audience', (
      with people as (
        select p.*, pp.birth_date
          from public.profiles p
          left join public.profile_private pp on pp.id = p.id
         where p.deleted_at is null and not p.is_test and p.onboarding_completed_at is not null
      )
      select jsonb_build_object(
        'looking_for', coalesce((
          select jsonb_object_agg(x, n) from (
            select x, count(*) as n from people, unnest(people.looking_for) as x group by x) l), '{}'::jsonb),
        'gender', coalesce((
          select jsonb_object_agg(gender, n) from (
            select gender, count(*) as n from people group by gender) g), '{}'::jsonb),
        'age', coalesce((
          select jsonb_object_agg(bucket, n) from (
            select case
                     when a < 21 then '18-20'
                     when a < 25 then '21-24'
                     when a < 30 then '25-29'
                     when a < 40 then '30-39'
                     else '40+'
                   end as bucket, count(*) as n
              from (select date_part('year', age(birth_date))::int as a from people where birth_date is not null) ages
             group by 1) b), '{}'::jsonb),
        'cities', coalesce((
          select jsonb_agg(jsonb_build_object('country', country_code, 'city', city, 'count', n) order by n desc, city)
            from (select country_code, city, count(*) as n from people
                   where city is not null group by country_code, city
                   order by n desc, city limit 8) c), '[]'::jsonb)
      )
    ),

    'requests', (
      select jsonb_build_object(
        'sent', count(*),
        'accepted', count(*) filter (where r.status = 'accepted'),
        'declined', count(*) filter (where r.status = 'declined'),
        'pending', count(*) filter (where r.status = 'pending')
      )
      from public.message_requests r
      join public.profiles p on p.id = r.sender_id
      where r.created_at >= v_start and not p.is_test
    ),

    'content', (
      select jsonb_build_object(
        'photos', count(*) filter (where m.kind = 'photo'),
        'voice', count(*) filter (where m.kind = 'voice'),
        'anon_chats', (select count(*) from public.anon_conversations a
                         join public.profiles ap on ap.id = a.recipient_id
                        where a.created_at >= v_start and not ap.is_test),
        'friendships', (select count(*) from public.friendships f
                          join public.profiles fp on fp.id = f.user_a
                         where f.created_at >= v_start and not fp.is_test)
      )
      from public.messages m
      join public.profiles p on p.id = m.sender_id
      where m.created_at >= v_start and not p.is_test
    ),

    -- Bekleyen işler: sayı + en eski kaydın zamanı (ne kadar bekletildiği).
    'queues', jsonb_build_object(
      'reports', (select jsonb_build_object('count', count(*), 'oldest', min(created_at))
                    from public.reports where status in ('open', 'reviewing')),
      'photos', (select jsonb_build_object('count', count(*), 'oldest', min(created_at))
                   from public.profile_photos where status = 'pending'),
      'age_documents', (select jsonb_build_object('count', count(*), 'oldest', min(created_at))
                          from private.age_documents where status = 'pending'),
      'student_documents', (select jsonb_build_object('count', count(*), 'oldest', min(created_at))
                              from private.student_documents where status = 'pending'),
      'appeals', (select jsonb_build_object('count', count(*), 'oldest', min(created_at))
                    from public.appeals where status = 'open')
    ),

    'report_reasons', coalesce((
      select jsonb_object_agg(reason, n) from (
        select r.reason, count(*) as n
          from public.reports r
          left join public.profiles p on p.id = r.reporter_id
         where r.created_at >= v_start and not coalesce(p.is_test, false)
         group by r.reason) x), '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_dashboard(integer) from public, anon, authenticated;
-- Yönetici denetimi fonksiyonun içinde (admin_audit 'forbidden' fırlatır).
grant execute on function public.admin_dashboard(integer) to authenticated;
