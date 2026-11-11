-- =============================================================================
-- Sohby — Yönetim paneli: Kullanıcı ayrıntısı
-- =============================================================================
-- * Bir kişinin profili, fotoğrafları, hakkındaki ve onun yaptığı şikâyetler,
--   itirazları, yaş belgesi durumları ve ona yapılmış yönetici işlemleri tek
--   yanıtta. Her açılış işlem kaydına yazılır (user.view).
-- * Kural 11: Flörtte ilgilenilen cinsiyet (private.dating_preferences) bu
--   yanıtta YOKTUR; yalnızca eşleştirme fonksiyonu kullanır.
-- * Kural 3: Mesaj İÇERİĞİ yoktur, yalnızca sayılar. Sohbet içeriği yalnızca
--   şikâyet ekranından, kayda geçerek görülür.
-- * Yaş belgesi dosyası yoktur, yalnızca durumu (belge Yaş doğrulama
--   ekranından, kayda geçerek açılır).
-- =============================================================================

create or replace function public.admin_get_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_email text;
  v_email_confirmed_at timestamptz;
begin
  perform private.admin_audit('user.view', 'user', p_user::text);
  select * into p from public.profiles where id = p_user;
  if not found then
    return null;
  end if;
  select u.email, u.email_confirmed_at into v_email, v_email_confirmed_at from auth.users u where u.id = p_user;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'email', v_email, 'email_confirmed_at', v_email_confirmed_at,
      'birth_date', (select pp.birth_date from public.profile_private pp where pp.id = p.id),
      'gender', p.gender, 'city', p.city, 'district', p.district, 'occupation', p.occupation, 'bio', p.bio,
      'looking_for', to_jsonb(p.looking_for), 'languages', to_jsonb(p.languages),
      'hobbies', (
        select coalesce(jsonb_agg(jsonb_build_object('tr', h.name_tr, 'en', h.name_en) order by h.name_tr), '[]'::jsonb)
        from public.profile_hobbies ph join public.hobbies h on h.id = ph.hobby_id
        where ph.profile_id = p.id
      ),
      'account_status', p.account_status, 'status_reason', p.status_reason,
      'suspended_until', p.suspended_until, 'status_changed_at', p.status_changed_at,
      'created_at', p.created_at, 'last_seen_at', p.last_seen_at,
      'onboarding_completed_at', p.onboarding_completed_at,
      'deleted_at', p.deleted_at, 'is_test', p.is_test
    ),
    'stats', jsonb_build_object(
      'conversations', (select count(*) from public.conversations c where c.user_a = p.id or c.user_b = p.id),
      'messages_sent', (select count(*) from public.messages m where m.sender_id = p.id),
      'blocked_by', (select count(*) from public.blocks b where b.blocked_id = p.id),
      'blocks_made', (select count(*) from public.blocks b where b.blocker_id = p.id)
    ),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ph.id, 'storage_path', ph.storage_path, 'status', ph.status, 'created_at', ph.created_at,
        'is_current', ph.id = p.photo_id) order by ph.created_at desc), '[]'::jsonb)
      from public.profile_photos ph where ph.user_id = p.id
    ),
    'reports_against', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
        'is_anonymous', r.anon_conversation_id is not null,
        'other', private.admin_user_brief(r.reporter_id)) order by r.created_at desc), '[]'::jsonb)
      from public.reports r where r.reported_id = p.id
    ),
    'reports_filed', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
        'is_anonymous', r.anon_conversation_id is not null,
        'other', private.admin_user_brief(r.reported_id)) order by r.created_at desc), '[]'::jsonb)
      from public.reports r where r.reporter_id = p.id
    ),
    'appeals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'account_status', a.account_status, 'message', a.message,
        'created_at', a.created_at, 'reviewed_at', a.reviewed_at) order by a.created_at desc), '[]'::jsonb)
      from public.appeals a where a.user_id = p.id
    ),
    'age_documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'status', d.status, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at,
        'review_note', d.review_note) order by d.created_at desc), '[]'::jsonb)
      from private.age_documents d where d.user_id = p.id
    ),
    -- Bu kişiye ya da onun fotoğraf/itiraz/belge/şikâyetlerine yapılmış yönetici
    -- işlemleri (görüntülemeler hariç), en yeni 50 tanesi.
    'admin_history', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.id desc), '[]'::jsonb)
      from (
        select l.id, l.action, l.target_type, l.details, l.created_at, ap.username as admin_username
        from private.admin_audit_log l
        left join public.profiles ap on ap.id = l.admin_id
        where l.action not like '%.view'
          and (
            (l.target_type = 'user' and l.target_id = p.id::text)
            or (l.target_type = 'photo' and l.target_id in (select ph.id::text from public.profile_photos ph where ph.user_id = p.id))
            or (l.target_type = 'appeal' and l.target_id in (select a.id::text from public.appeals a where a.user_id = p.id))
            or (l.target_type = 'age_document' and l.target_id in (select d.id::text from private.age_documents d where d.user_id = p.id))
            or (l.target_type = 'report' and l.target_id in (select r.id::text from public.reports r where r.reported_id = p.id))
          )
        order by l.id desc
        limit 50
      ) x
    )
  );
end;
$$;

revoke execute on function public.admin_get_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
