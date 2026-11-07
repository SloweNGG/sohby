-- =============================================================================
-- Sohby — 16: Mesaj kimliğini gönderen üretir (güvenilir anlık iletim)
-- =============================================================================
-- İstemci, gönderdiği mesajın kimliğini (UUID) kendisi üretir. Böylece:
--  * ekranda hemen görünen mesaj, Realtime'dan / eksik tamamlamadan gelen
--    gerçek kayıtla kimliğinden eşleşir (tekilleştirme kesin);
--  * "tekrar dene" aynı kimlikle gönderilir; ilk deneme aslında yazılmışsa
--    birincil anahtar ikinci kaydı engeller → mesaj asla iki kez yazılmaz.
-- Güvenlik: kimlik yalnızca bir anahtardır. Gönderen, zaman ve sohbet yine
-- sunucuda / RLS'te belirlenir; var olan bir kimlik seçilirse ekleme reddedilir.
-- =============================================================================

grant insert (id) on public.messages to authenticated;

-- Anonim mesaj: isteğe bağlı istemci kimliği; aynı kimlikle tekrar gönderim
-- (aynı sohbet, aynı taraf) yeni kayıt oluşturmaz, var olanı döndürür.
drop function public.send_anon_message(uuid, text);
create function public.send_anon_message(p_conversation uuid, p_body text, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text := private.anon_role(p_conversation, auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.anon_messages%rowtype;
begin
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_id is not null then
    select * into v_row from public.anon_messages where id = p_id;
    if found then
      if v_row.conversation_id = p_conversation and v_row.from_anonymous = (v_role = 'anonymous') then
        return to_jsonb(v_row);
      end if;
      raise exception 'duplicate_id' using errcode = '23505';
    end if;
  end if;

  if not private.can_send_anon(p_conversation, v_me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  -- Dakikada 30 mesaj (tarafın kendi mesajları).
  if (
    select count(*) from public.anon_messages
    where conversation_id = p_conversation
      and from_anonymous = (v_role = 'anonymous')
      and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.anon_messages (id, conversation_id, from_anonymous, body)
  values (coalesce(p_id, gen_random_uuid()), p_conversation, v_role = 'anonymous', v_body)
  returning * into v_row;

  update public.anon_conversations
     set last_message_at = v_row.created_at,
         anon_last_read_at = case when v_role = 'anonymous' then v_row.created_at else anon_last_read_at end,
         recipient_last_read_at = case when v_role = 'recipient' then v_row.created_at else recipient_last_read_at end
   where id = p_conversation;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.send_anon_message(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.send_anon_message(uuid, text, uuid) to authenticated;
