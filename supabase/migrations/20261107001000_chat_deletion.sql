-- =============================================================================
-- Sohby — 10: Sohbet silme (yalnızca kendi görünümünden), toplu işlemler
-- =============================================================================
-- CLAUDE.md kural 13: Sohbet silme yalnızca kullanıcının kendi görünümünden
-- siler; mesajlar şikâyet incelemesi için saklanır.
-- Karar (90 gün): Bir mesaj İKİ tarafın da görünümünden silinmişse ve son
-- silmenin üzerinden 90 gün geçtiyse kalıcı olarak silinir. Tek taraf sildiyse
-- karşı tarafın mesajları ona ait olduğundan korunur. Açık şikâyet varsa beklenir.
-- =============================================================================

alter table public.conversations
  add column a_cleared_at timestamptz,
  add column b_cleared_at timestamptz;

comment on column public.conversations.a_cleared_at is
  'user_a bu andan önceki mesajları kendi görünümünden sildi.';

-- Mesajlar: taraf, kendi sildiği andan önceki mesajları API'den de göremez.
drop policy "messages: sohbetin tarafları okur" on public.messages;
create policy "messages: sohbetin tarafları okur"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (
          (c.user_a = (select auth.uid()) and messages.created_at > coalesce(c.a_cleared_at, '-infinity'::timestamptz))
          or (c.user_b = (select auth.uid()) and messages.created_at > coalesce(c.b_cleared_at, '-infinity'::timestamptz))
        )
    )
  );

create or replace function public.get_conversations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select
      c.id,
      c.last_message_at,
      case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id,
      case when c.user_a = auth.uid() then c.a_last_read_at else c.b_last_read_at end as my_last_read,
      coalesce(case when c.user_a = auth.uid() then c.a_cleared_at else c.b_cleared_at end, '-infinity'::timestamptz) as my_cleared
    from public.conversations c
    where auth.uid() in (c.user_a, c.user_b)
      -- Kendi görünümünden silinmiş sohbet, yeni mesaj gelene kadar listelenmez.
      and coalesce(c.last_message_at, c.created_at) > coalesce(case when c.user_a = auth.uid() then c.a_cleared_at else c.b_cleared_at end, '-infinity'::timestamptz)
  )
  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]'::jsonb)
  from (
    select
      coalesce(m.last_message_at, '-infinity'::timestamptz) as sort_at,
      jsonb_build_object(
        'id', m.id,
        'other', private.profile_card(m.other_id, auth.uid()),
        'last_message', (
          select jsonb_build_object(
            'body', left(lm.body, 140),
            'created_at', lm.created_at,
            'from_me', lm.sender_id = auth.uid()
          )
          from public.messages lm
          where lm.conversation_id = m.id and lm.created_at > m.my_cleared
          order by lm.created_at desc
          limit 1
        ),
        'unread_count', (
          select count(*)
          from public.messages um
          where um.conversation_id = m.id
            and um.sender_id <> auth.uid()
            and um.created_at > coalesce(m.my_last_read, '-infinity'::timestamptz)
            and um.created_at > m.my_cleared
        )
      ) as row_data
    from mine m
    where not private.is_blocked_between(auth.uid(), m.other_id)
      and not private.anon_blocked(m.other_id, auth.uid())
  ) rows
$$;

-- Tek sohbeti kendi görünümünden sil (okundu da sayılır).
create or replace function public.hide_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set a_cleared_at = case when c.user_a = auth.uid() then now() else c.a_cleared_at end,
         b_cleared_at = case when c.user_b = auth.uid() then now() else c.b_cleared_at end,
         a_last_read_at = case when c.user_a = auth.uid() then now() else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = auth.uid() then now() else c.b_last_read_at end
   where c.id = p_conversation and auth.uid() in (c.user_a, c.user_b);
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Tüm sohbetleri kendi görünümünden sil.
create or replace function public.hide_all_conversations()
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.conversations c
       set a_cleared_at = case when c.user_a = auth.uid() then now() else c.a_cleared_at end,
           b_cleared_at = case when c.user_b = auth.uid() then now() else c.b_cleared_at end,
           a_last_read_at = case when c.user_a = auth.uid() then now() else c.a_last_read_at end,
           b_last_read_at = case when c.user_b = auth.uid() then now() else c.b_last_read_at end
     where auth.uid() in (c.user_a, c.user_b)
    returning 1
  )
  select count(*)::integer from updated
$$;

-- Tümünü okundu işaretle (normal ve anonim sohbetler).
create or replace function public.mark_all_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set a_last_read_at = case when c.user_a = auth.uid() then now() else c.a_last_read_at end,
         b_last_read_at = case when c.user_b = auth.uid() then now() else c.b_last_read_at end
   where auth.uid() in (c.user_a, c.user_b);
  update public.anon_conversations c
     set anon_last_read_at = case when private.anon_role(c.id, auth.uid()) = 'anonymous' then now() else c.anon_last_read_at end,
         recipient_last_read_at = case when c.recipient_id = auth.uid() then now() else c.recipient_last_read_at end
   where private.anon_role(c.id, auth.uid()) is not null;
end;
$$;

-- 90 gün: iki tarafın da sildiği mesajların kalıcı silinmesi.
create or replace function private.purge_hidden_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
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
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'underage', private.purge_underage_accounts(),
    'deleted_accounts', private.purge_deleted_accounts(),
    'hidden_messages', private.purge_hidden_messages()
  );
end;
$$;

revoke execute on function public.hide_conversation(uuid) from public, anon, authenticated;
revoke execute on function public.hide_all_conversations() from public, anon, authenticated;
revoke execute on function public.mark_all_read() from public, anon, authenticated;
revoke execute on function private.purge_hidden_messages() from public, anon, authenticated;
grant execute on function public.hide_conversation(uuid) to authenticated;
grant execute on function public.hide_all_conversations() to authenticated;
grant execute on function public.mark_all_read() to authenticated;
