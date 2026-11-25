-- "Yazıyor…" göstergesi: Supabase Realtime Broadcast (özel kanal).
--
-- Hiçbir şey veritabanına yazılmaz; yazıyor sinyali yalnızca Realtime
-- sunucusundan geçer. Kimin kanala katılabileceğini Realtime, aşağıdaki
-- realtime.messages kurallarıyla (RLS) kanal açılırken ve oturum anahtarı
-- yenilenince kontrol eder.
--
-- Kanal adları (istemci `{ config: { private: true } }` ile açar):
--   typing:c:<conversation_id>       normal sohbet
--   typing:a:<anon_conversation_id>  anonim sohbet
--
-- Kurallar:
--   * Dinleme: yalnızca sohbetin iki tarafı ve aralarında engel yokken
--     (kural 3, 6). Anonim sohbette yalnızca etkin sohbet.
--   * Gönderme: yalnızca o sohbete şu an mesaj yazabilen taraf (e-posta
--     doğrulanmış, iki hesap etkin, engel yok; kural 6, 9). Böylece engellenen
--     kişi "yazıyor…" da gösteremez.
--   * Anonim sohbette yük yalnızca hangi tarafın yazdığını taşır
--     ("anon" / "recipient"); kişi kimliği hiçbir yükte yoktur (kural 10).

create or replace function private.typing_allowed(p_topic text, p_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_topic text := regexp_replace(coalesce(p_topic, ''), '^realtime:', '');
  v_kind text;
  v_id uuid;
begin
  if v_uid is null then
    return false;
  end if;
  -- Biçim dışı adlar (ve geçersiz kimlikler) sessizce reddedilir.
  if v_topic !~ '^typing:[ca]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_kind := split_part(v_topic, ':', 2);
  v_id := split_part(v_topic, ':', 3)::uuid;

  if v_kind = 'c' then
    if p_send then
      return private.can_send_message_as(v_id, v_uid);
    end if;
    return exists (
      select 1
      from public.conversations c
      where c.id = v_id
        and v_uid in (c.user_a, c.user_b)
        and not private.is_blocked_between(c.user_a, c.user_b)
    );
  end if;

  if p_send then
    return private.can_send_anon(v_id, v_uid);
  end if;
  return exists (
    select 1
    from public.anon_conversations c
    join private.anon_senders s on s.conversation_id = c.id
    where c.id = v_id
      and c.status = 'active'
      and v_uid in (s.sender_id, c.recipient_id)
      and not private.is_blocked_between(s.sender_id, c.recipient_id)
      and not private.anon_blocked(c.recipient_id, s.sender_id)
  );
end;
$$;

revoke execute on function private.typing_allowed(text, boolean) from public, anon;
grant execute on function private.typing_allowed(text, boolean) to authenticated;

-- Bu kurallar yalnızca özel kanallara uygulanır; mevcut mesaj kanalları
-- (postgres_changes) bunlardan etkilenmez.
create policy "typing: sohbetin tarafları dinler"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.typing_allowed((select realtime.topic()), false)
  );

create policy "typing: yazabilen taraf gönderir"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.typing_allowed((select realtime.topic()), true)
  );
