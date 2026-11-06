-- =============================================================================
-- Sohby — 4: CLAUDE.md güvenlik kurallarına uyum düzeltmeleri
-- =============================================================================
-- Bu dosya, ilk üç migration CLAUDE.md'deki "Güvenlik kuralları" ile tek tek
-- karşılaştırıldıktan sonra yazıldı. Her bölüm hangi kuralı düzelttiğini belirtir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Kural 11 — Flörtte ilgilenilen cinsiyet özel nitelikli veridir:
--   ayrı tabloda tutulur, HİÇBİR kullanıcı okuyamaz (sahibi dahil), yalnızca
--   eşleştirme fonksiyonu kullanır, rıza geri çekilince silinir.
-- Önceki durum: profiles.dating_interest sütununu sahibi okuyabiliyordu ve
-- rıza profile_private'ta ayrı duruyordu.
-- -----------------------------------------------------------------------------

-- `private` şeması API'ye açık değildir; tabloya hiçbir rol için yetki verilmez.
create table private.dating_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  interested_in text[] not null
    check (
      cardinality(interested_in) between 1 and 3
      and interested_in <@ array['female', 'male', 'other']::text[]
    ),
  -- Açık rıza zamanı; satır yalnızca rıza ile oluşur, rıza geri çekilince silinir.
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.dating_preferences enable row level security;
revoke all on private.dating_preferences from public, anon, authenticated;
-- Bilinçli olarak hiç politika yok: tabloya yalnızca SECURITY DEFINER
-- fonksiyonlar (sahibi postgres) erişir.

-- Varsa mevcut veriyi taşı (uzak veritabanı boş olsa da güvenli).
insert into private.dating_preferences (user_id, interested_in, consented_at)
select p.id, p.dating_interest, pp.dating_consent_at
from public.profiles p
join public.profile_private pp on pp.id = p.id
where 'flirt' = any (p.looking_for)
  and pp.dating_consent_at is not null
  and cardinality(p.dating_interest) > 0;

-- Eski sütunlar kaldırılır (sütun yetkileri de onlarla birlikte gider).
alter table public.profiles drop column dating_interest;
alter table public.profile_private drop column dating_consent_at;

-- Profil tetikleyicisi: flört yalnızca rıza kaydı varsa seçilebilir; flört
-- bırakılınca rıza ve ilgi bilgisi silinir.
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

  new.looking_for := array(select distinct unnest(new.looking_for));
  new.languages := array(select distinct unnest(new.languages));

  if 'flirt' = any (new.looking_for) then
    if not exists (select 1 from private.dating_preferences where user_id = new.id) then
      raise exception 'dating_consent_required' using errcode = '22023';
    end if;
  else
    -- Rıza geri çekildi sayılır: özel nitelikli veri silinir.
    delete from private.dating_preferences where user_id = new.id;
  end if;

  select * into v_private from public.profile_private where id = new.id;

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
    new.onboarding_completed_at := old.onboarding_completed_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.profile_private_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.birth_date is distinct from old.birth_date
     and current_setting('sohby.allow_birth_date', true) is distinct from 'on' then
    raise exception 'birth_date_immutable' using errcode = '42501';
  end if;
  if new.birth_date is not null and not private.is_adult_birth_date(new.birth_date) then
    raise exception 'underage' using errcode = '22023';
  end if;
  new.age_check_failed_at := coalesce(old.age_check_failed_at, new.age_check_failed_at);

  -- Koşul onayı zamanı istemciden değil sunucu saatinden yazılır ve geri alınamaz.
  if new.terms_accepted_at is null then
    new.terms_accepted_at := old.terms_accepted_at;
  else
    new.terms_accepted_at := coalesce(old.terms_accepted_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Eşleştirme fonksiyonu: ilgi bilgisini yalnızca burada okur, dışarıya
-- yalnızca evet/hayır döner.
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
    join private.dating_preferences ad on ad.user_id = a.id
    join public.profiles b on b.id = p_b
    join private.dating_preferences bd on bd.user_id = b.id
    where a.id = p_a
      and a.id <> b.id
      and 'flirt' = any (a.looking_for)
      and 'flirt' = any (b.looking_for)
      and b.gender = any (ad.interested_in)
      and a.gender = any (bd.interested_in)
  )
$$;

-- Açık rıza + ilgi tercihi kaydı (flört seçmeden önce çağrılır).
create or replace function public.set_dating_preferences(p_interested_in text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_interest text[] := array(select distinct unnest(coalesce(p_interested_in, '{}')));
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if cardinality(v_interest) not between 1 and 3
     or not v_interest <@ array['female', 'male', 'other']::text[] then
    raise exception 'dating_interest_required' using errcode = '22023';
  end if;

  insert into private.dating_preferences (user_id, interested_in)
  values (v_me, v_interest)
  on conflict (user_id) do update
    set interested_in = excluded.interested_in, updated_at = now();
end;
$$;

-- Rızayı geri çek: ilgi bilgisi silinir, flört seçeneği kaldırılır.
create or replace function public.withdraw_dating_consent()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from private.dating_preferences where user_id = auth.uid();
  update public.profiles
     set looking_for = array_remove(looking_for, 'flirt')
   where id = auth.uid() and 'flirt' = any (looking_for);
end;
$$;

-- Kullanıcı yalnızca rızasının OLUP OLMADIĞINI öğrenebilir; ilgi bilgisini değil.
create or replace function public.has_dating_consent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.dating_preferences where user_id = auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- Kural 9 — E-posta doğrulanmadan mesaj gönderilemez.
-- Önceki durum: yalnızca Supabase panelindeki "Confirm email" ayarına
-- güveniliyordu; veritabanında kontrol yoktu.
-- -----------------------------------------------------------------------------
create or replace function private.is_email_verified(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = p_user and email_confirmed_at is not null
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
  )
$$;

-- -----------------------------------------------------------------------------
-- Kural 8 — Günde en fazla 20 YENİ KİŞİYE ilk mesaj.
-- Önceki durum: yalnızca mesaj istekleri sayılıyordu; mesaj ayarı "herkes"
-- olan kişilere doğrudan açılan sohbetler sınırın dışında kalıyordu.
-- -----------------------------------------------------------------------------
alter table public.conversations add column initiated_by uuid;

comment on column public.conversations.initiated_by is
  'Sohbeti doğrudan ilk mesajla açan kişi (istekten doğan sohbetlerde boş). Hız sınırı için.';

create index conversations_initiated_idx on public.conversations (initiated_by, created_at desc)
  where initiated_by is not null;

-- Son 24 saatte ilk mesaj atılan yeni kişi sayısı (istekler + doğrudan sohbetler).
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
  )::integer
$$;

drop function private.ensure_conversation(uuid, uuid);

create function private.ensure_conversation(p_a uuid, p_b uuid, p_initiated_by uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.conversations (user_a, user_b, initiated_by)
  values (least(p_a, p_b), greatest(p_a, p_b), p_initiated_by)
  on conflict (user_a, user_b) do nothing
  returning id into v_id;

  if v_id is null then
    v_id := private.conversation_between(p_a, p_b);
  end if;
  return v_id;
end;
$$;

create or replace function public.start_conversation(
  p_target uuid,
  p_body text,
  p_flirt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_mode text;
  v_conversation uuid;
  v_request uuid;
  v_incoming public.message_requests%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  -- Kural 9
  if not private.is_email_verified(v_me) then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;
  if p_target is null or p_target = v_me
     or not private.profile_visible_to(p_target, v_me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  -- Sohbet zaten varsa mesaj doğrudan oraya gider (yeni kişi değil).
  v_conversation := private.conversation_between(v_me, p_target);
  if v_conversation is not null then
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- Karşı taraf bana istek gönderdiyse: yazmam isteği kabul etmektir (yeni kişi değil).
  select * into v_incoming from public.message_requests
   where sender_id = p_target and recipient_id = v_me and status = 'pending'
   for update;
  if found then
    v_conversation := public.respond_message_request(v_incoming.id, true);
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- Kural 7: kabul edilene kadar tek mesaj. Bekleyen ya da reddedilmiş istek
  -- varsa yeni mesaj oluşturulmaz (gönderen reddedildiğini öğrenmez).
  select id into v_request from public.message_requests
   where sender_id = v_me and recipient_id = p_target
     and status in ('pending', 'declined')
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object('kind', 'request', 'id', null);
  end if;

  if p_flirt and not private.flirt_compatible(v_me, p_target) then
    raise exception 'flirt_not_allowed' using errcode = '42501';
  end if;

  v_mode := private.message_mode(p_target, v_me);
  if v_mode = 'not_allowed' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Kural 8: yeni kişiye ilk mesaj — doğrudan sohbet ya da istek fark etmez.
  if private.new_contacts_last_day(v_me) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if v_mode = 'direct' and not p_flirt then
    v_conversation := private.ensure_conversation(v_me, p_target, v_me);
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  insert into public.message_requests (sender_id, recipient_id, body, is_flirt)
  values (v_me, p_target, v_body, coalesce(p_flirt, false))
  returning id into v_request;

  return jsonb_build_object('kind', 'request', 'id', v_request);
end;
$$;

-- -----------------------------------------------------------------------------
-- Kural 13 — Mesajlar şikâyet incelemesi için belirli bir süre saklanır.
-- Önceki durum: bir hesap silinirse (auth.users → profiles cascade) sohbetler,
-- mesajlar ve istekler anında ve geri dönüşsüz siliniyordu.
-- Şimdilik: mesaj içeren kayıtlar hesap silinerek yok edilemez (RESTRICT).
-- Saklama süresi belirlenince, hesap silme akışı (Edge Function) kişiyi
-- anonimleştirip süre dolunca mesajları temizleyecek şekilde yazılmalı.
-- -----------------------------------------------------------------------------
alter table public.conversations
  drop constraint conversations_user_a_fkey,
  add constraint conversations_user_a_fkey
    foreign key (user_a) references public.profiles (id) on delete restrict,
  drop constraint conversations_user_b_fkey,
  add constraint conversations_user_b_fkey
    foreign key (user_b) references public.profiles (id) on delete restrict;

alter table public.messages
  drop constraint messages_sender_id_fkey,
  add constraint messages_sender_id_fkey
    foreign key (sender_id) references public.profiles (id) on delete restrict,
  drop constraint messages_conversation_id_fkey,
  add constraint messages_conversation_id_fkey
    foreign key (conversation_id) references public.conversations (id) on delete restrict;

alter table public.message_requests
  drop constraint message_requests_sender_id_fkey,
  add constraint message_requests_sender_id_fkey
    foreign key (sender_id) references public.profiles (id) on delete restrict,
  drop constraint message_requests_recipient_id_fkey,
  add constraint message_requests_recipient_id_fkey
    foreign key (recipient_id) references public.profiles (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- Fonksiyon yetkileri (yeni ve yeniden oluşturulanlar)
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
