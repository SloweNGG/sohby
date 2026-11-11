-- "Çevrimiçi görün" yeni hesaplarda varsayılan olarak açık (kullanıcı kararı,
-- 2026-11-11). Başlangıç sorularının gizlilik adımında ve Ayarlar'da kapatılabilir.
-- Mevcut hesapların seçimine dokunulmaz.
alter table public.profiles alter column show_online set default true;
