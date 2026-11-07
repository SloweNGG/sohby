-- =============================================================================
-- Sohby — 13: Anonim sohbetlerde "sohbeti sil" (yalnızca kendi görünümünden)
-- =============================================================================
-- Kullanıcı kararı: anonim sohbetlerde de silme normal sohbetlerle aynı çalışır.
-- CLAUDE.md kural 13: silme yalnızca kendi görünümünden; mesajlar saklanır.
-- Kural 10: silme karşı tarafın görünümünü değiştirmez; hiçbir yanıta kimlik
-- eklenmez.
-- 90 gün kararı: iki taraf da sildiyse ve son silmenin üzerinden 90 gün geçtiyse
-- mesajlar kalıcı silinir; açık şikâyet varsa beklenir.
-- =============================================================================

alter table public.anon_conversations
  add column anon_cleared_at timestamptz,
  add column recipient_cleared_at timestamptz;

comment on column public.anon_conversations.anon_cleared_at is
  'Anonim taraf bu andan önceki mesajları kendi görünümünden sildi.';
comment on column public.anon_conversations.recipient_cleared_at is
  'Alıcı bu andan önceki mesajları kendi görünümünden sildi.';

-- İzleyenin bu sohbette sildiği an (yoksa -infinity).
create or replace function private.anon_cleared_for(p_conversation uuid, p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case private.anon_role(c.id, p_user)
      when 'anonymous' then c.anon_cleared_at
      when 'recipient' then c.recipient_cleared_at
    end,
    '-infinity'::timestamptz)
  from public.anon_conversations c
  where c.id = p_conversation
$$;

-- Mesajlar: taraf, kendi sildiği andan önceki mesajları API'den (ve Realtime'dan) göremez.
drop policy "anon_messages: taraflar okur" on public.anon_messages;
create policy "anon_messages: taraflar okur"
  on public.anon_messages for select to authenticated
  using (
    private.anon_role(conversation_id, (select auth.uid())) is not null
    and anon_messages.created_at > private.anon_cleared_for(conversation_id, (select auth.uid()))
  );

-- Liste: silinmiş sohbet yeni mesaj gelene kadar görünmez; önizleme ve okunmamış
-- sayısı yalnızca silmeden sonraki mesajlardan hesaplanır.
create or replace function public.get_anon_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
  from (
    select
      coalesce(c.last_message_at, c.created_at) as sort_at,
      jsonb_build_object(
        'id', c.id,
        'role', r.role,
        -- Gönderen reddi öğrenmez: reddedilmiş sohbet ona "bekliyor" görünür.
        'status', case when r.role = 'anonymous' and c.status = 'declined' then 'pending' else c.status end,
        'alias_adjective', c.alias_adjective,
        'alias_animal', c.alias_animal,
        'reveal_requested', c.reveal_requested_at is not null,
        'created_at', c.created_at,
        -- Gönderen, yazdığı kişiyi zaten tanır; alıcı gönderen hakkında hiçbir şey almaz.
        'recipient', case when r.role = 'anonymous' then private.profile_card(c.recipient_id, auth.uid()) end,
        'last_message', (
          select jsonb_build_object('body', left(m.body, 140), 'created_at', m.created_at,
                                    'from_me', m.from_anonymous = (r.role = 'anonymous'))
          from public.anon_messages m
          where m.conversation_id = c.id and m.created_at > r.cleared
          order by m.created_at desc limit 1
        ),
        'unread_count', (
          select count(*) from public.anon_messages m
          where m.conversation_id = c.id
            and m.from_anonymous <> (r.role = 'anonymous')
            and m.created_at > r.cleared
            and m.created_at > coalesce(
              case when r.role = 'anonymous' then c.anon_last_read_at else c.recipient_last_read_at end,
              '-infinity'::timestamptz)
        )
      ) as item
    from public.anon_conversations c
    cross join lateral (
      select x.role,
             coalesce(case x.role when 'anonymous' then c.anon_cleared_at
                                  when 'recipient' then c.recipient_cleared_at end,
                      '-infinity'::timestamptz) as cleared
      from (select private.anon_role(c.id, auth.uid()) as role) x
    ) r
    where r.role is not null
      and c.status <> 'revealed'
      -- Alıcı reddettiği anonim istekleri görmez.
      and not (r.role = 'recipient' and c.status = 'declined')
      -- Kendi görünümünden silinmiş sohbet, yeni mesaj gelene kadar listelenmez.
      and coalesce(c.last_message_at, c.created_at) > r.cleared
      and not private.is_blocked_between(private.anon_sender_of(c.id), c.recipient_id)
      and not private.anon_blocked(c.recipient_id, private.anon_sender_of(c.id))
  ) x
$$;

-- Tek anonim sohbeti kendi görünümünden sil (okundu da sayılır).
-- Alıcı için bekleyen istek bir "sohbet" değildir (kabul/ret ile yanıtlanır);
-- bu yüzden alıcı yalnızca açık sohbeti silebilir. Anonim taraf, kendisine
-- "bekliyor" görünen sohbeti de silebilir.
create or replace function public.hide_anon_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.anon_role(p_conversation, auth.uid());
begin
  update public.anon_conversations c
     set anon_cleared_at = case when v_role = 'anonymous' then now() else c.anon_cleared_at end,
         anon_last_read_at = case when v_role = 'anonymous' then now() else c.anon_last_read_at end,
         recipient_cleared_at = case when v_role = 'recipient' then now() else c.recipient_cleared_at end,
         recipient_last_read_at = case when v_role = 'recipient' then now() else c.recipient_last_read_at end
   where c.id = p_conversation
     and (
       (v_role = 'anonymous' and c.status in ('pending', 'active', 'declined'))
       or (v_role = 'recipient' and c.status = 'active')
     );
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Tüm sohbetleri sil: normal + anonim (aynı kurallarla).
create or replace function public.hide_all_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_normal integer;
  v_anon integer;
  v_recipient integer;
begin
  update public.conversations c
     set a_cleared_at = case when c.user_a = v_me then now() else c.a_cleared_at end,
         b_cleared_at = case when c.user_b = v_me then now() else c.b_cleared_at end,
         a_last_read_at = case when c.user_a = v_me then now() else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = v_me then now() else c.b_last_read_at end
   where v_me in (c.user_a, c.user_b);
  get diagnostics v_normal = row_count;

  update public.anon_conversations c
     set anon_cleared_at = now(), anon_last_read_at = now()
   where c.status in ('pending', 'active', 'declined')
     and exists (select 1 from private.anon_senders s where s.conversation_id = c.id and s.sender_id = v_me);
  get diagnostics v_anon = row_count;

  update public.anon_conversations c
     set recipient_cleared_at = now(), recipient_last_read_at = now()
   where c.recipient_id = v_me and c.status = 'active';
  get diagnostics v_recipient = row_count;

  return v_normal + v_anon + v_recipient;
end;
$$;

-- Kimlik açılınca mesajlar normal sohbete taşınır; tarafların sildiği mesajlar
-- orada da görünmez (silme anı normal sohbete aktarılır).
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
  insert into public.messages (conversation_id, sender_id, body, created_at)
  select v_target, case when m.from_anonymous then v_me else v_conv.recipient_id end, m.body, m.created_at
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

-- 90 gün: iki tarafın da sildiği mesajların kalıcı silinmesi (normal + anonim).
create or replace function private.purge_hidden_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normal integer;
  v_anon integer;
begin
  delete from public.messages m
   using public.conversations c
   where m.conversation_id = c.id
     and c.a_cleared_at is not null and c.b_cleared_at is not null
     and m.created_at <= least(c.a_cleared_at, c.b_cleared_at)
     and greatest(c.a_cleared_at, c.b_cleared_at) < now() - interval '90 days'
     and not exists (
       select 1 from public.reports r
       where r.conversation_id = c.id and r.status in ('open', 'reviewing')
     );
  get diagnostics v_normal = row_count;

  delete from public.anon_messages m
   using public.anon_conversations c
   where m.conversation_id = c.id
     and c.anon_cleared_at is not null and c.recipient_cleared_at is not null
     and m.created_at <= least(c.anon_cleared_at, c.recipient_cleared_at)
     and greatest(c.anon_cleared_at, c.recipient_cleared_at) < now() - interval '90 days'
     and not exists (
       select 1 from public.reports r
       where r.anon_conversation_id = c.id and r.status in ('open', 'reviewing')
     );
  get diagnostics v_anon = row_count;

  return v_normal + v_anon;
end;
$$;

revoke execute on function private.anon_cleared_for(uuid, uuid) from public, anon;
grant execute on function private.anon_cleared_for(uuid, uuid) to authenticated;
revoke execute on function public.hide_anon_conversation(uuid) from public, anon, authenticated;
revoke execute on function public.hide_all_conversations() from public, anon, authenticated;
revoke execute on function public.reveal_identity(uuid) from public, anon, authenticated;
revoke execute on function private.purge_hidden_messages() from public, anon, authenticated;
grant execute on function public.hide_anon_conversation(uuid) to authenticated;
grant execute on function public.hide_all_conversations() to authenticated;
grant execute on function public.reveal_identity(uuid) to authenticated;
