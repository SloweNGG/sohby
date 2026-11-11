-- =============================================================================
-- Engellenen profil görünümü ve engellenenler listesinde fotoğraf
-- =============================================================================
-- Kullanıcı kararı: engelleyince (ya da şikâyet edip engelleyince) Keşfet'e
-- gönderilmesin; profil sayfasında kalsın, fotoğraf bulanık ve "Engellendi".
-- * get_profile: engellediğim kişi için yalnızca ad + ana fotoğraf + blocked_by_me.
-- * Storage: engelleyen, engellediğinin yalnızca ana fotoğrafını görebilir.
-- * get_blocked_users: normal engellerde ana fotoğraf yolu da döner.
-- Kural 6 değişmez: engellenen, engelleyeni hiçbir yerde göremez.
-- Kural 10: anonim sohbetten yapılan engeller bu görünümlere girmez.
-- =============================================================================

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

  -- Benim engellediğim kişi: profil "Engellendi" görünümüyle kalır (yalnızca ad ve
  -- ana fotoğraf; uygulama bulanık gösterir). Anonim sohbetten yapılan engeller
  -- sayılmaz: kimlik sızmasın (kural 10). Karşı taraf beni yine göremez (kural 6).
  if exists (
    select 1 from public.blocks b
    where b.blocker_id = v_me and b.blocked_id = v_target and b.anon_conversation_id is null
  ) then
    return (
      select jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', coalesce(p.display_name, p.username),
        'photo_path', private.current_photo_path(p.id),
        'blocked_by_me', true,
        'blocked_at', (select b.created_at from public.blocks b
                       where b.blocker_id = v_me and b.blocked_id = v_target and b.anon_conversation_id is null),
        'is_self', false
      )
      from public.profiles p
      where p.id = v_target and p.deleted_at is null
    );
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

create or replace function private.can_view_profile_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_photos ph
    where ph.storage_path = p_name
      and (
        ph.user_id = auth.uid()
        or private.is_admin(auth.uid())
        or (ph.status = 'approved' and private.profile_visible_to(ph.user_id, auth.uid()))
        -- Engellediğim kişinin yalnızca ANA fotoğrafı ("Engellendi" görünümü ve
        -- engellenenler listesi için). Anonim sohbetten yapılan engel sayılmaz.
        or (
          ph.status = 'approved'
          and exists (select 1 from public.profiles p where p.id = ph.user_id and p.photo_id = ph.id)
          and exists (
            select 1 from public.blocks b
            where b.blocker_id = auth.uid() and b.blocked_id = ph.user_id and b.anon_conversation_id is null
          )
        )
      )
  )
$$;

create or replace function public.get_blocked_users()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by blocked_at desc), '[]'::jsonb)
  from (
    select
      b.created_at as blocked_at,
      case
        when b.anon_conversation_id is null then jsonb_build_object(
          'id', p.id, 'username', p.username,
          'display_name', coalesce(p.display_name, p.username), 'blocked_at', b.created_at,
          'photo_path', private.current_photo_path(p.id),
          'anon_conversation_id', null, 'alias_adjective', null, 'alias_animal', null)
        else jsonb_build_object(
          'id', null, 'username', null, 'display_name', null, 'blocked_at', b.created_at,
          'anon_conversation_id', b.anon_conversation_id,
          'alias_adjective', c.alias_adjective, 'alias_animal', c.alias_animal)
      end as item
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
    left join public.anon_conversations c on c.id = b.anon_conversation_id
    where b.blocker_id = auth.uid()
  ) x
$$;
