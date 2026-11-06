-- =============================================================================
-- Sohby — 7: Gizlilik ayarları (okundu bilgisi, anonim mesaj kabulü, dil)
-- =============================================================================

alter table public.profiles
  add column show_read_receipts boolean not null default true,
  add column accept_anonymous boolean not null default true,
  add column preferred_locale text not null default 'tr' check (preferred_locale in ('tr', 'en'));

comment on column public.profiles.show_read_receipts is
  'Okundu bilgisi karşılıklıdır: kapatan kişi başkalarının okundu bilgisini de göremez.';

grant update (show_read_receipts, accept_anonymous, preferred_locale) on public.profiles to authenticated;

-- Sohbet başlığı: karşı tarafın okuma zamanı yalnızca İKİ TARAF da okundu
-- bilgisini açık tuttuysa döner. (conversations tablosu Realtime yayınında
-- değildir; aksi hâlde ham okuma zamanları ayardan bağımsız sızardı.)
create or replace function public.get_conversation(p_conversation uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'other', private.profile_card(o.other_id, auth.uid()),
    'can_send', private.can_send_message(c.id),
    'other_read_at', case
      when me.show_read_receipts and them.show_read_receipts
        then case when c.user_a = o.other_id then c.a_last_read_at else c.b_last_read_at end
    end
  )
  from public.conversations c
  cross join lateral (
    select case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id
  ) o
  join public.profiles me on me.id = auth.uid()
  join public.profiles them on them.id = o.other_id
  where c.id = p_conversation
    and auth.uid() in (c.user_a, c.user_b)
    and not private.is_blocked_between(c.user_a, c.user_b)
$$;
