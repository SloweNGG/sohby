-- =============================================================================
-- YEDEK YOL. Normalde gerekmez: testler her çalıştırmanın sonunda kendi
-- hesaplarını siler, kalanları da veritabanı 2 saat sonra kendisi siler
-- (migration 17, saatlik görev). Hemen temizlemek istersen:
-- Uçtan uca test hesaplarını ve tüm verilerini KALICI olarak siler.
-- Yalnızca e-postası "e2e-test-…@example.com" olan hesaplar etkilenir.
-- Kullanım: Supabase paneli → SQL Editor → bu dosyanın içeriğini yapıştır → Run.
-- (Gerçek bir kullanıcıyla test hesabı arasındaki sohbet de silinir.)
-- Yönetici işlem kaydı silinemez olduğu için oradaki satırlar kalır.
-- =============================================================================
begin;

create temp table e2e_users on commit drop as
  select id from auth.users where email like 'e2e-test-%@example.com';

create temp table e2e_anon on commit drop as
  select conversation_id as id from private.anon_senders
  where sender_id in (select id from e2e_users) or recipient_id in (select id from e2e_users);

create temp table e2e_conv on commit drop as
  select id from public.conversations
  where user_a in (select id from e2e_users) or user_b in (select id from e2e_users);

-- Şikâyetler (test şikâyetleri; silinmezse kişi alanı boşalıp kuyrukta kalırdı)
delete from public.reports
 where reporter_id in (select id from e2e_users)
    or reported_id in (select id from e2e_users)
    or conversation_id in (select id from e2e_conv)
    or anon_conversation_id in (select id from e2e_anon);

-- Anonim sohbetler (mesajlar önce; gönderen eşlemesi sohbetle birlikte silinir)
delete from public.anon_messages where conversation_id in (select id from e2e_anon);
delete from public.anon_conversations where id in (select id from e2e_anon);

-- Normal sohbetler ve istekler
delete from public.messages where conversation_id in (select id from e2e_conv);
delete from public.conversations where id in (select id from e2e_conv);
delete from public.message_requests
 where sender_id in (select id from e2e_users) or recipient_id in (select id from e2e_users);

-- Hesaplar (profil, gizli profil, hobiler, engeller, itirazlar, fotoğraf kayıtları vb. birlikte silinir)
delete from auth.users where id in (select id from e2e_users);

commit;
