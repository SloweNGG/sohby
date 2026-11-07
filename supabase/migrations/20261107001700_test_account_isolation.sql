-- =============================================================================
-- Sohby — 17: Test hesapları (e2e-test-…@example.com) — ayrı dünya + otomatik silme
-- =============================================================================
-- Kullanıcı kararı: uçtan uca testlerin hesapları gerçek kullanıcılara hiçbir
-- zaman görünmez; testler kendi hesaplarını her çalıştırmanın sonunda siler.
--
--  * profiles.is_test: e-posta adresinden belirlenir (kayıtta ve e-posta
--    değişince); kullanıcı değiştiremez.
--  * Görünmez duvar: test hesabı ile gerçek hesap arasında
--    private.is_blocked_between her zaman "engelli" döner. Bu kontrol Keşfet,
--    arama, profil, mesaj, istek, sohbet listeleri, rozetler ve anonim sohbetin
--    hepsinde zaten kullanılıyor (ileride harita da aynı kontrolü kullanmalı).
--    Böylece iki taraf birbirini hiçbir yerde göremez ve birbirine yazamaz.
--  * Hızlı silme yalnızca test hesapları için ve YALNIZCA verileri başka test
--    hesaplarıyla ilgiliyse yapılır. Gerçek bir hesapla herhangi bir etkileşimi
--    olan hesap bu yolla silinemez (kural 13: mesajlar şikâyet incelemesi için
--    saklanır; biri test adresiyle kayıt olup iz silemesin diye).
--  * Güvenlik ağı: test yarıda kesilse bile, 2 saatten eski test hesapları
--    saatlik görevle silinir.
-- =============================================================================

alter table public.profiles add column is_test boolean not null default false;
comment on column public.profiles.is_test is
  'Uçtan uca test hesabı (e2e-test-…@example.com). Gerçek hesaplardan tamamen yalıtılır.';

create or replace function private.is_test_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(p_email) ~ '^e2e-test-[a-z0-9-]+@example\.com$', false)
$$;

-- Profil oluşurken (kayıt) bayrak e-postadan yazılır; sonradan kullanıcı değiştiremez.
create or replace function private.profiles_set_test_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.is_test := private.is_test_email((select email from auth.users where id = new.id));
  elsif current_setting('sohby.syncing_test_flag', true) is distinct from 'on' then
    new.is_test := old.is_test;
  end if;
  return new;
end;
$$;

-- "a_" öneki: diğer BEFORE tetikleyicilerinden önce çalışır (ad sırası).
create trigger a_profiles_test_flag
  before insert or update on public.profiles
  for each row execute function private.profiles_set_test_flag();

-- E-posta değişirse bayrak yeniden hesaplanır ("elle değiştirilemez" kuralı bu
-- güncelleme için işlem içi geçici bayrakla aşılır; aynı yöntem flört eşitlemesinde de var).
create or replace function private.auth_user_email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('sohby.syncing_test_flag', 'on', true);
    update public.profiles set is_test = private.is_test_email(new.email) where id = new.id;
    perform set_config('sohby.syncing_test_flag', 'off', true);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.auth_user_email_changed();

-- Var olan hesaplar
alter table public.profiles disable trigger a_profiles_test_flag;
alter table public.profiles disable trigger profiles_before_update;
update public.profiles p set is_test = true
  from auth.users u where u.id = p.id and private.is_test_email(u.email);
alter table public.profiles enable trigger profiles_before_update;
alter table public.profiles enable trigger a_profiles_test_flag;

create or replace function private.is_test_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_test from public.profiles where id = p_user), false)
$$;

-- Görünmez duvar: normal engel YA DA biri test hesabı, diğeri değil.
create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where anon_conversation_id is null
      and ((blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a))
  )
  or (p_a is not null and p_b is not null
      and private.is_test_account(p_a) is distinct from private.is_test_account(p_b))
$$;

-- -----------------------------------------------------------------------------
-- Test hesabının silinmesi
-- -----------------------------------------------------------------------------

-- Hesabın gerçek (test olmayan) bir hesapla herhangi bir izi var mı?
create or replace function private.test_account_touches_real(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.conversations c
            where p_user in (c.user_a, c.user_b)
              and not private.is_test_account(case when c.user_a = p_user then c.user_b else c.user_a end))
    or exists (select 1 from public.message_requests r
               where p_user in (r.sender_id, r.recipient_id)
                 and not private.is_test_account(case when r.sender_id = p_user then r.recipient_id else r.sender_id end))
    or exists (select 1 from private.anon_senders s
               where p_user in (s.sender_id, s.recipient_id)
                 and not private.is_test_account(case when s.sender_id = p_user then s.recipient_id else s.sender_id end))
    or exists (select 1 from public.reports r
               where (r.reporter_id = p_user and r.reported_id is not null and not private.is_test_account(r.reported_id))
                  or (r.reported_id = p_user and r.reporter_id is not null and not private.is_test_account(r.reporter_id)))
    or exists (select 1 from public.blocks b
               where (b.blocker_id = p_user and not private.is_test_account(b.blocked_id))
                  or (b.blocked_id = p_user and not private.is_test_account(b.blocker_id)))
$$;

-- Test hesabını ve (yalnızca test hesaplarıyla olan) tüm verisini kalıcı siler.
-- Test hesabı değilse ya da gerçek bir hesapla izi varsa hiçbir şey silmez (false).
create or replace function private.purge_test_account(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or not private.is_test_account(p_user) then
    return false;
  end if;
  if private.test_account_touches_real(p_user) then
    raise warning 'purge_test_account: % gerçek bir hesapla etkileşimde; hızlı silme yapılmadı', p_user;
    return false;
  end if;

  delete from public.reports r
   where r.reporter_id = p_user or r.reported_id = p_user
      or r.conversation_id in (select id from public.conversations where p_user in (user_a, user_b))
      or r.anon_conversation_id in (select conversation_id from private.anon_senders where p_user in (sender_id, recipient_id))
      or r.message_request_id in (select id from public.message_requests where p_user in (sender_id, recipient_id));
  delete from public.anon_messages
   where conversation_id in (select conversation_id from private.anon_senders where p_user in (sender_id, recipient_id));
  delete from public.anon_conversations
   where id in (select conversation_id from private.anon_senders where p_user in (sender_id, recipient_id));
  delete from public.messages
   where conversation_id in (select id from public.conversations where p_user in (user_a, user_b));
  delete from public.conversations where p_user in (user_a, user_b);
  delete from public.message_requests where p_user in (sender_id, recipient_id);
  -- Hesap: profil, gizli profil, hobiler, engeller, itirazlar, fotoğraf ve belge kayıtları birlikte silinir.
  delete from auth.users where id = p_user;
  return true;
end;
$$;

-- Test, çalıştırma sonunda kendi hesabını siler (yalnızca test hesapları).
create or replace function public.e2e_delete_my_test_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_test_account(auth.uid()) then
    raise exception 'not_test_account' using errcode = '42501';
  end if;
  if not private.purge_test_account(auth.uid()) then
    raise exception 'cannot_purge' using errcode = '42501';
  end if;
end;
$$;

-- Güvenlik ağı: yarıda kalan çalıştırmaların hesapları.
create or replace function private.purge_stale_test_accounts(p_older_than interval default interval '2 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select p.id from public.profiles p join auth.users u on u.id = p.id
    where p.is_test and u.created_at < now() - p_older_than
  loop
    begin
      if private.purge_test_account(v_id) then
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'purge_stale_test_accounts: % silinemedi: %', v_id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sohby-purge-test-accounts', '53 * * * *', 'select private.purge_stale_test_accounts()');
  end if;
end;
$$;

revoke execute on function private.is_test_email(text) from public, anon, authenticated;
revoke execute on function private.profiles_set_test_flag() from public, anon, authenticated;
revoke execute on function private.auth_user_email_changed() from public, anon, authenticated;
revoke execute on function private.is_test_account(uuid) from public, anon, authenticated;
revoke execute on function private.test_account_touches_real(uuid) from public, anon, authenticated;
revoke execute on function private.purge_test_account(uuid) from public, anon, authenticated;
revoke execute on function private.purge_stale_test_accounts(interval) from public, anon, authenticated;
revoke execute on function public.e2e_delete_my_test_account() from public, anon, authenticated;
grant execute on function public.e2e_delete_my_test_account() to authenticated;
