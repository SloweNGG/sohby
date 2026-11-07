-- =============================================================================
-- Sohby — 14: Reddedilen istekler
-- =============================================================================
-- Kullanıcı kararı:
--  * Reddedilen istekten sonra gönderen aynı kişiye bir daha istek gönderemez
--    (kalıcı). Gönderen reddi öğrenmez; isteği ona hep "bekliyor" görünür.
--  * Reddeden kişi isterse kendisi yazabilir: yazması reddi geri alıp isteği
--    kabul etmek demektir (gönderenin ilk mesajı sohbete taşınır).
--  * Reddeden kişi Ayarlar > "Reddedilen istekler" listesinden reddi geri
--    alabilir: istek yeniden "bekleyen" olur ve İstekler'e döner.
-- Anonim istekler de listede yer alır; yalnızca takma ad gösterilir (kural 10).
-- =============================================================================

-- Yazma: karşı tarafın bana gönderdiği bekleyen YA DA reddettiğim istek varsa,
-- yazmam o isteği kabul etmektir (yeni kişi sayılmaz).
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

  -- Karşı taraf bana istek gönderdiyse (bekleyen ya da benim reddettiğim):
  -- yazmam isteği kabul etmektir.
  select * into v_incoming from public.message_requests
   where sender_id = p_target and recipient_id = v_me and status in ('pending', 'declined')
   order by (status = 'pending') desc, created_at desc
   limit 1
   for update;
  if found then
    if v_incoming.status = 'declined' then
      update public.message_requests
         set status = 'pending', responded_at = null
       where id = v_incoming.id;
    end if;
    v_conversation := public.respond_message_request(v_incoming.id, true);
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conversation, v_me, v_body);
    return jsonb_build_object('kind', 'conversation', 'id', v_conversation);
  end if;

  -- Kural 7: kabul edilene kadar tek mesaj. Bekleyen ya da reddedilmiş istek
  -- varsa yeni mesaj oluşturulmaz (gönderen reddedildiğini öğrenmez; kalıcı).
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

-- Profil: reddettiğim kişi bana istek göndermiş olduğundan ona doğrudan
-- yazabilirim (karşı tarafın mesaj ayarı ne olursa olsun).
create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_incoming uuid;
  v_outgoing boolean;
  v_declined_by_me boolean;
  v_conversation uuid;
  v_mode text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select id into v_target from public.profiles
   where username = lower(btrim(coalesce(p_username, '')));
  if v_target is null then
    return null;
  end if;

  if v_target = v_me then
    return private.profile_card(v_target, v_me) || jsonb_build_object(
      'is_self', true,
      'message_mode', 'not_allowed',
      'conversation_id', null,
      'incoming_request_id', null,
      'outgoing_request_pending', false,
      'flirt_compatible', false
    );
  end if;

  if not private.is_active_user(v_me) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if not private.profile_visible_to(v_target, v_me) then
    return null;
  end if;

  select id into v_incoming from public.message_requests
   where sender_id = v_target and recipient_id = v_me and status = 'pending';

  select exists (
    select 1 from public.message_requests
    where sender_id = v_target and recipient_id = v_me and status = 'declined'
  ) into v_declined_by_me;

  -- Reddedilmiş istekler de gönderene "bekliyor" olarak görünür.
  select exists (
    select 1 from public.message_requests
    where sender_id = v_me and recipient_id = v_target and status in ('pending', 'declined')
  ) into v_outgoing;

  v_conversation := private.conversation_between(v_target, v_me);
  v_mode := private.message_mode(v_target, v_me);
  if v_conversation is null and v_incoming is null and v_declined_by_me then
    v_mode := 'direct';
  end if;

  return private.profile_card(v_target, v_me) || jsonb_build_object(
    'is_self', false,
    'message_mode', v_mode,
    'conversation_id', v_conversation,
    'incoming_request_id', v_incoming,
    'outgoing_request_pending', coalesce(v_outgoing, false),
    'flirt_compatible', private.flirt_compatible(v_me, v_target)
  );
end;
$$;

-- Ayarlar > Reddedilen istekler: yalnızca BENİM reddettiğim istekler.
-- Anonim isteklerde gönderen hakkında yalnızca takma ad döner (kural 10);
-- süzgeçler get_anon_conversations ile aynıdır (yeni bir yan kanal açılmaz).
create or replace function public.get_declined_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by declined_at desc), '[]'::jsonb)
  from (
    select
      coalesce(r.responded_at, r.created_at) as declined_at,
      jsonb_build_object(
        'kind', 'request',
        'id', r.id,
        'sender', private.profile_card(r.sender_id, auth.uid()),
        'body', left(r.body, 140),
        'is_flirt', r.is_flirt,
        'created_at', r.created_at,
        'declined_at', r.responded_at
      ) as item
    from public.message_requests r
    where r.recipient_id = auth.uid()
      and r.status = 'declined'
      and private.is_active_user(r.sender_id)
      and not private.is_blocked_between(r.sender_id, r.recipient_id)
      and private.conversation_between(r.sender_id, r.recipient_id) is null
    union all
    select
      coalesce(c.responded_at, c.created_at),
      jsonb_build_object(
        'kind', 'anonymous',
        'id', c.id,
        'alias_adjective', c.alias_adjective,
        'alias_animal', c.alias_animal,
        'body', (
          select left(m.body, 140) from public.anon_messages m
          where m.conversation_id = c.id order by m.created_at limit 1
        ),
        'created_at', c.created_at,
        'declined_at', c.responded_at
      )
    from public.anon_conversations c
    where c.recipient_id = auth.uid()
      and c.status = 'declined'
      and not exists (select 1 from public.blocks b where b.anon_conversation_id = c.id)
      and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
      and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id))
    order by 1 desc
    limit 200
  ) x
$$;

-- Reddi geri al: istek yeniden bekleyen olur ve İstekler'e döner.
create or replace function public.undo_decline(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_requests r
     set status = 'pending', responded_at = null
   where r.id = p_request
     and r.recipient_id = auth.uid()
     and r.status = 'declined'
     and private.is_active_user(r.sender_id)
     and not private.is_blocked_between(r.sender_id, r.recipient_id)
     and private.conversation_between(r.sender_id, r.recipient_id) is null;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.undo_anon_decline(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.anon_conversations c
     set status = 'pending', responded_at = null
   where c.id = p_conversation
     and c.recipient_id = auth.uid()
     and c.status = 'declined'
     and not exists (select 1 from public.blocks b where b.anon_conversation_id = c.id)
     and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
     and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id));
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.get_declined_requests() from public, anon, authenticated;
revoke execute on function public.undo_decline(uuid) from public, anon, authenticated;
revoke execute on function public.undo_anon_decline(uuid) from public, anon, authenticated;
revoke execute on function public.start_conversation(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.get_profile(text) from public, anon, authenticated;
grant execute on function public.get_declined_requests() to authenticated;
grant execute on function public.undo_decline(uuid) to authenticated;
grant execute on function public.undo_anon_decline(uuid) to authenticated;
grant execute on function public.start_conversation(uuid, text, boolean) to authenticated;
grant execute on function public.get_profile(text) to authenticated;
