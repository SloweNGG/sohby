-- =============================================================================
-- Sohby — Mesaja tepki (emoji)
-- =============================================================================
-- * Sohbetler her zaman iki kişiliktir; bu yüzden bir mesajda en çok iki tepki
--   olur: mesajı GÖNDERENİN tepkisi (sender_reaction) ve KARŞI TARAFIN tepkisi
--   (recipient_reaction). Sütunlarda kişi kimliği yoktur → anonim sohbette de
--   tepki kimlik sızdırmaz (kural 10).
-- * Tepki ayrı bir tabloda TUTULMAZ: Supabase Realtime silme (DELETE) olaylarını
--   RLS'e bakmadan tabloya abone olan herkese gönderir. Ayrı tablodaki bir
--   tepkinin silinmesi (birincil anahtarındaki kullanıcı kimliğiyle) başkalarına
--   sızardı. Mesaj satırının GÜNCELLENMESİ ise RLS'e tabidir: olayı yalnızca
--   sohbetin iki tarafı alır (kural 3).
-- * Tepki yalnızca RPC ile bırakılır (react_to_message / react_to_anon_message):
--   taraf mı, sohbet kullanıcının görünümünde mi, yazmaya izinli mi (engel,
--   askı, e-posta doğrulaması — kural 6, 9), emoji geçerli mi, hız sınırı.
-- * updated_at: mesajın son değişikliği. İstemci, bağlantı kopup gelince
--   eksikleri bu zamana göre tamamlar (yeni mesajlar + kaçırılan tepkiler).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sütunlar
-- -----------------------------------------------------------------------------
alter table public.messages
  add column sender_reaction text,
  add column recipient_reaction text,
  add column updated_at timestamptz;
update public.messages set updated_at = created_at;
alter table public.messages
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.anon_messages
  add column sender_reaction text,
  add column recipient_reaction text,
  add column updated_at timestamptz;
update public.anon_messages set updated_at = created_at;
alter table public.anon_messages
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index messages_conversation_updated_idx on public.messages (conversation_id, updated_at);
create index anon_messages_conversation_updated_idx on public.anon_messages (conversation_id, updated_at);

-- Her güncellemede değişiklik zamanı sunucuda yazılır (istemci yazamaz; zaten
-- UPDATE yetkisi yok).
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger messages_touch_updated_at
  before update on public.messages
  for each row execute function private.touch_updated_at();
create trigger anon_messages_touch_updated_at
  before update on public.anon_messages
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Emoji doğrulama
-- -----------------------------------------------------------------------------
-- Tepki TEK bir emoji olmalı (yan yana birden çok emoji ya da yazı değil).
-- Karakterler emoji aralıklarında olmalı; ikinci bir resimli karakter yalnızca
-- birleştirici (ZWJ, ör. 👨‍👩‍👧) ardından, ten rengi olarak (👍🏽) ya da bayrak
-- çiftinin ikinci harfi olarak (🇹🇷) gelebilir. # * 0-9 yalnızca tuş başlığı
-- dizisinin başında (1️⃣). En çok 16 karakter (en uzun diziler sığar).
create or replace function private.is_reaction(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cp integer;
  v_prev integer := 0;
  v_has_base boolean := false;   -- bir resimli (ya da tuş başlığı) temel görüldü
  v_keycap_base boolean := false;
  v_regional integer := 0;       -- bölge harfi sayısı (bayrak = 2)
begin
  if p is null or char_length(p) < 1 or char_length(p) > 16 then
    return false;
  end if;
  for i in 1 .. char_length(p) loop
    v_cp := ascii(substr(p, i, 1));
    if v_cp in (35, 42) or v_cp between 48 and 57 then
      -- # * 0-9: yalnızca ilk karakter ve ardından tuş başlığı (20E3) gelmeli.
      if i <> 1 then return false; end if;
      v_keycap_base := true;
    elsif v_cp = 65039 then
      -- Emoji biçim seçicisi (FE0F): bir karakterin ardından.
      if i = 1 then return false; end if;
    elsif v_cp = 8205 then
      -- ZWJ (200D): bir emojinin ardından, bir sonrakine bağlar.
      if not v_has_base then return false; end if;
    elsif v_cp = 8419 then
      -- Tuş başlığı (20E3)
      if not v_keycap_base then return false; end if;
      v_has_base := true;
    elsif v_cp between 917536 and 917631 then
      -- Etiket karakterleri (E0020–E007F): bölge bayrakları (ör. İskoçya)
      if not v_has_base then return false; end if;
    elsif v_cp between 127995 and 127999 then
      -- Ten rengi (1F3FB–1F3FF): bir emojinin ardından.
      if not v_has_base then return false; end if;
    elsif v_cp between 127462 and 127487 then
      -- Bölge harfleri (1F1E6–1F1FF): iki tanesi bir bayrak yapar.
      if v_keycap_base then return false; end if;
      v_regional := v_regional + 1;
      if v_regional = 1 and v_has_base and v_prev <> 8205 then return false; end if;
      if v_regional > 2 then return false; end if;
      v_has_base := true;
    elsif v_cp in (169, 174, 8252, 8265, 8482, 8505, 9410, 12336, 12349, 12951, 12953)
       or v_cp between 8592 and 8703    -- oklar
       or v_cp between 8960 and 9215    -- çeşitli teknik (⌚ ⏰ …)
       or v_cp between 9632 and 10175   -- geometrik şekiller, çeşitli semboller, dingbat
       or v_cp between 10496 and 10623  -- ek oklar
       or v_cp between 11008 and 11263  -- çeşitli semboller ve oklar (⭐ ⬆ …)
       or v_cp between 126976 and 129791 -- 1F000–1FAFF: emoji blokları
    then
      -- İkinci bir emoji yalnızca birleştiriciden (ZWJ) sonra gelebilir.
      if v_keycap_base then return false; end if;
      if v_has_base and v_prev <> 8205 then return false; end if;
      v_has_base := true;
    else
      return false;
    end if;
    v_prev := v_cp;
  end loop;
  return v_has_base and v_prev <> 8205 and v_regional in (0, 2);
end;
$$;

-- -----------------------------------------------------------------------------
-- Hız sınırı: dakikada en çok 60 tepki değişikliği (kişi başına, iki sohbet
-- türü birlikte). Kayıtlar kendi kendini temizler; kullanıcıya görünmez.
-- -----------------------------------------------------------------------------
create table private.reaction_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index reaction_events_user_idx on private.reaction_events (user_id, created_at);
alter table private.reaction_events enable row level security;
revoke all on private.reaction_events from public, anon, authenticated;

create or replace function private.reaction_rate_check(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.reaction_events
   where user_id = p_user and created_at < now() - interval '1 minute';
  if (select count(*) from private.reaction_events where user_id = p_user) >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.reaction_events (user_id) values (p_user);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: normal sohbette tepki. p_reaction null → tepkiyi kaldır.
-- Dönüş: mesajın güncel satırı (istemci listesine birleştirir).
-- -----------------------------------------------------------------------------
create or replace function public.react_to_message(p_message uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages%rowtype;
  v_conv public.conversations%rowtype;
  v_reaction text := nullif(p_reaction, '');
begin
  select * into v_msg from public.messages where id = p_message for update;
  if found then
    select * into v_conv from public.conversations where id = v_msg.conversation_id;
  end if;
  -- Taraf değilse ya da mesaj kendi görünümünden silinmişse: yok say.
  if not found
     or v_me is null
     or v_me not in (v_conv.user_a, v_conv.user_b)
     or v_msg.created_at <= coalesce(case when v_conv.user_a = v_me then v_conv.a_cleared_at else v_conv.b_cleared_at end,
                                     '-infinity'::timestamptz)
  then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not private.can_send_message_as(v_conv.id, v_me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_reaction is not null and not private.is_reaction(v_reaction) then
    raise exception 'invalid_reaction' using errcode = '22023';
  end if;

  -- Değişiklik yoksa yazma (gereksiz Realtime olayı ve sınır sayımı yok).
  if (v_msg.sender_id = v_me and v_msg.sender_reaction is not distinct from v_reaction)
     or (v_msg.sender_id <> v_me and v_msg.recipient_reaction is not distinct from v_reaction) then
    return to_jsonb(v_msg);
  end if;

  perform private.reaction_rate_check(v_me);

  update public.messages
     set sender_reaction = case when sender_id = v_me then v_reaction else sender_reaction end,
         recipient_reaction = case when sender_id <> v_me then v_reaction else recipient_reaction end
   where id = p_message
  returning * into v_msg;

  return to_jsonb(v_msg);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: anonim sohbette tepki. Taraf, kimlikle değil rolle belirlenir.
-- -----------------------------------------------------------------------------
create or replace function public.react_to_anon_message(p_message uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_msg public.anon_messages%rowtype;
  v_role text;
  v_mine boolean;
  v_reaction text := nullif(p_reaction, '');
begin
  select * into v_msg from public.anon_messages where id = p_message for update;
  if found then
    v_role := private.anon_role(v_msg.conversation_id, v_me);
  end if;
  if not found
     or v_role is null
     or v_msg.created_at <= private.anon_cleared_for(v_msg.conversation_id, v_me)
  then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not private.can_send_anon(v_msg.conversation_id, v_me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_reaction is not null and not private.is_reaction(v_reaction) then
    raise exception 'invalid_reaction' using errcode = '22023';
  end if;

  v_mine := v_msg.from_anonymous = (v_role = 'anonymous');
  if (v_mine and v_msg.sender_reaction is not distinct from v_reaction)
     or (not v_mine and v_msg.recipient_reaction is not distinct from v_reaction) then
    return to_jsonb(v_msg);
  end if;

  perform private.reaction_rate_check(v_me);

  update public.anon_messages
     set sender_reaction = case when v_mine then v_reaction else sender_reaction end,
         recipient_reaction = case when not v_mine then v_reaction else recipient_reaction end
   where id = p_message
  returning * into v_msg;

  return to_jsonb(v_msg);
end;
$$;

-- -----------------------------------------------------------------------------
-- Kimlik açılınca tepkiler de normal sohbete taşınır. (Sütunlar "gönderen" /
-- "karşı taraf" olarak tutulduğundan eşleme gerekmez.)
-- -----------------------------------------------------------------------------
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
  insert into public.messages (conversation_id, sender_id, body, created_at, sender_reaction, recipient_reaction)
  select v_target, case when m.from_anonymous then v_me else v_conv.recipient_id end, m.body, m.created_at,
         m.sender_reaction, m.recipient_reaction
  from public.anon_messages m
  where m.conversation_id = p_conversation
  order by m.created_at;
  perform set_config('sohby.bulk_move', 'off', true);

  update public.conversations c
     set a_last_read_at = case when c.user_a = v_me then now() else greatest(c.a_last_read_at, v_conv.recipient_last_read_at) end,
         b_last_read_at = case when c.user_b = v_me then now() else greatest(c.b_last_read_at, v_conv.recipient_last_read_at) end,
         a_cleared_at = case when c.user_a = v_me
                             then greatest(c.a_cleared_at, v_conv.anon_cleared_at)
                             else greatest(c.a_cleared_at, v_conv.recipient_cleared_at) end,
         b_cleared_at = case when c.user_b = v_me
                             then greatest(c.b_cleared_at, v_conv.anon_cleared_at)
                             else greatest(c.b_cleared_at, v_conv.recipient_cleared_at) end
   where c.id = v_target;

  update public.anon_conversations
     set status = 'revealed', revealed_conversation_id = v_target
   where id = p_conversation;

  return v_target;
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
revoke execute on function private.touch_updated_at() from public, anon, authenticated;
revoke execute on function private.is_reaction(text) from public, anon, authenticated;
revoke execute on function private.reaction_rate_check(uuid) from public, anon, authenticated;
revoke execute on function public.react_to_message(uuid, text) from public, anon, authenticated;
revoke execute on function public.react_to_anon_message(uuid, text) from public, anon, authenticated;
revoke execute on function public.reveal_identity(uuid) from public, anon, authenticated;
grant execute on function public.react_to_message(uuid, text) to authenticated;
grant execute on function public.react_to_anon_message(uuid, text) to authenticated;
grant execute on function public.reveal_identity(uuid) to authenticated;
