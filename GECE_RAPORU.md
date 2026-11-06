# Gece Raporu — 7 Kasım 2026

> Bu dosya her adımdan sonra güncellendi. En güncel durum en üstteki özet tablodadır.

## Özet

| # | Adım | Durum |
| --- | --- | --- |
| 1 | Next.js + Cloudflare Workers + Tailwind + next-intl + tema | ✅ Bitti |
| 2 | Veritabanı migration'ları + RLS | ✅ Bitti (35 test geçiyor) |
| 3 | Kayıt / giriş / şifre sıfırlama | ✅ Bitti (gerçek Supabase'le denenemedi) |
| 4 | Başlangıç soruları akışı | ✅ Bitti |
| 5 | Keşfet + filtreler + kişi profili | ✅ Bitti |
| 6 | Birebir mesajlaşma (Realtime) | ✅ Bitti (Realtime gerçek Supabase'le denenemedi) |
| 7 | Mesaj istekleri | ✅ Bitti |
| 8 | Engelle / şikâyet et | ✅ Bitti |
| 9 | Tanıtım sayfası | ✅ Bitti |

## Kısaca

9 adımın **hepsi bitti** ve her biri ayrı commit'lendi (`git log`). Hiçbir şey canlıya yüklenmedi,
migration'lar uzak veritabanına uygulanmadı, gizli anahtar kullanılmadı.

Doğrulama: `npm test` → **40/40** (35 veritabanı/RLS + 5 birim testi), `tsc` ve ESLint temiz,
`next build` ve `opennextjs-cloudflare build` başarılı. Her ekran masaüstü (1440) ve telefon (390)
genişliğinde ekran görüntüsüyle tasarımla karşılaştırıldı (örnek veriyle; önizleme sayfaları silindi).

**Denenemeyen tek şey: gerçek Supabase'e karşı uçtan uca akış** (kayıt e-postası, giriş, Realtime),
çünkü proje adresi gelmedi. Kod yolları yazıldı ve veritabanı mantığı gerçek Postgres'te (PGlite) test
edildi; ama ilk gerçek kullanımda küçük ayar sorunları çıkabilir.

## ⚠️ Sabah ilk bakman gerekenler

1. **CLAUDE.md bulunamadı.** Klasörde `CLAUDE.md` yok, `claudecode.md` boş (0 bayt). "Güvenlik
   kurallarına birebir uy" talimatını bu yüzden uygulayamadım; yerine **en sıkı** kuralları seçtim
   (Adım 2 → "Güvenlik varsayımları"). Dosyayı paylaşırsan migration'ı onunla karşılaştırırım.
2. **Supabase adresi eksik.** `NEXT_PUBLIC_SUPABASE_URL=[PROJE_ADRESİ]` yer tutucu olarak geldi;
   `.env.local`'e aynen yazdım. Gerçek adresi (`https://xxxx.supabase.co`) girmen gerekiyor.
   Adres geçersizken uygulama çökmüyor: sayfalar açılıyor, Supabase gerektiren işlemler
   "yapılandırma eksik" diyor, korumalı sayfalar girişe yönleniyor.
3. **Migration'ları uygulamak** (sen onaylayınca): `supabase link --project-ref <ref>` → `supabase db push`
   ya da SQL Editor'de `supabase/migrations/` altındaki üç dosyayı sırayla çalıştır.
4. **Supabase paneli ayarları** (Adım 3 sonundaki liste): yönlendirme adresleri, e-posta şablonları, Google.

## Sana sormam gerekenler

1. **CLAUDE.md'deki güvenlik kuralları** neler? (Yukarıdaki madde 1.)
2. **Kullanıcı adıyla giriş** istiyor musun? Güvenli yapmak için sunucu tarafında gizli anahtarlı bir
   Edge Function gerekir. Şimdilik giriş yalnızca e-posta ile.
3. **Şehir listesi yalnızca Türkiye'nin 81 ili.** Yurt dışındaki kullanıcılar da olacak mı?
4. **Reddedilen istek kalıcı mı olsun?** Şu an gönderen asla öğrenmiyor ve aynı kişiye bir daha istek
   atamıyor. Örneğin 30 gün sonra yeniden izin verelim mi?
5. **Flört eşleşmesi** şu an karşılıklı (iki taraf da flört seçmiş, açık rıza vermiş ve birbirinin cinsiyet
   tercihine uyuyor). "Cinsiyet belirtmek istemiyorum" diyenler flört eşleşmesine giremiyor. Uygun mu?
6. **"Ayrıca engelle" varsayılan olarak işaretli.** Kalsın mı?
7. **Başlangıç soruları 7 adım** (flört seçilirse 8). Tasarımda "1 / 8" yazıyor; 8'e tamamlamak için bir
   adım (ör. fotoğraf) eklemek ister misin?
8. **Hukuki metinler**: kullanım koşulları, KVKK aydınlatma metni, gizlilik politikası, iletişim bilgisi.
   Şu an yer tutucu; açık rıza metni de hukukçuya gösterilmeli.
9. **Gizli anahtar gerektiren, bilerek atladığım işler:** hesap silme (KVKK için gerekli), şikâyet
   inceleme paneli, kullanıcı adıyla giriş. Bunlar için Edge Function / yönetici paneli planlayalım mı?
10. **Sıradaki işler**: fotoğraf yükleme, profil düzenleme (tasarım 10), ayarlar ve gizlilik (tasarım 11),
    engellenenler listesi, bildirimler, harita, anonim mesaj, arkadaşlık. Öncelik sırası?

## Adım 1 — Proje kurulumu ✅

- Next.js 16.4.5 + React 19 + TypeScript + Tailwind v4 + ESLint.
- `@opennextjs/cloudflare` 1.20.16 + `wrangler.jsonc` + `open-next.config.ts`.
  `npm run cf:build` başarıyla `.open-next/worker.js` üretiyor. **Deploy yapılmadı.**
- next-intl 4: `tr` varsayılan (öneksiz), `en` → `/en/...`. Çeviriler `messages/tr.json`, `messages/en.json`.
- Tasarım belirteçleri `src/app/globals.css` → `coral`, `lilac`, `surface`, `moon` + türetilmiş gece tonları.
- Sora yazı tipi `next/font/google` ile (latin + latin-ext → Türkçe karakterler).
- Supabase istemcileri: `src/lib/supabase/{client,server,env}.ts`; yalnızca publishable anahtar.
- `src/middleware.ts`: dil yönlendirmesi + Supabase oturum yenileme + korumalı sayfalar.
- Güvenlik başlıkları (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy).
- `.env.local` ve `.dev.vars` `.gitignore`'da; `.env.example` commit'lendi (boş değerlerle).

### Kararlar
- **`middleware.ts` (edge) kullanıldı, `proxy.ts` değil.** Next 16 `middleware`'i kullanımdan kaldırdı
  ama yeni `proxy.ts` yalnızca Node runtime'da çalışıyor; OpenNext bunu Workers'ta "deneysel,
  desteklenmiyor" diye işaretliyor. Build sırasında bir deprecation uyarısı çıkıyor, bu bilinçli.
- **`cacheComponents` kapatıldı** (create-next-app varsayılanı açıktı). Uygulama neredeyse tamamen
  oturuma bağlı ve OpenNext bu özelliği belgelemiyor.
- **URL'ler İngilizce** (`/login`, `/discover`, `/chats`) — iki dilde ayrı yol çevirisi (pathnames)
  yerine sade yapı. İstersen sonra `/giris`, `/kesfet` gibi Türkçe yollara geçilebilir.
- npm 11 `workerd` paketinin kurulum betiğini çalıştırmadı (güvenlik varsayılanı). `cf:build` bundan
  etkilenmiyor; `npm run preview` (yerel wrangler) için `npm approve-scripts workerd` gerekebilir.

## Adım 2 — Veritabanı ✅

Dosyalar: `supabase/migrations/2026110700{0100,0200,0300}_*.sql` — **uzak veritabanına uygulanmadı.**

| Tablo | İçerik | Erişim |
| --- | --- | --- |
| `profiles` | ad, kullanıcı adı, cinsiyet, şehir/semt, hakkında, aradıkları, diller, gizlilik ayarları | Yalnızca **sahibi** okur/günceller (sütun bazlı). Başkaları yalnızca RPC ile, gizlilik filtresinden geçmiş hâlini görür |
| `profile_private` | doğum tarihi, flört açık rızası, koşullar onayı | Yalnızca sahibi okur; doğum tarihi doğrudan **değiştirilemez** |
| `hobbies` + `profile_hobbies` | 48 hobilik sabit katalog + kullanıcı seçimi (en çok 15) | Katalog herkese açık; seçimleri yalnızca sahibi görür/değiştirir |
| `conversations` | iki kişilik sohbet, okundu işaretleri | Yalnızca iki taraf okur; yazma yalnızca RPC |
| `messages` | metin mesajı (1–2000 karakter) | Yalnızca taraflar okur; yalnızca kendi adına, izinli sohbete yazar; düzenleme/silme yok |
| `message_requests` | ilk mesaj istekleri | Yalnızca **alıcı** okur; gönderen reddedildiğini öğrenemez |
| `blocks` | engellemeler | Yalnızca engelleyen görür; engellenen anlayamaz |
| `reports` | şikâyetler (neden + not + bağlam) | Yalnızca şikâyet eden kendi kaydını görür; değiştirme/silme yok |

### Güvenlik varsayımları (CLAUDE.md olmadığı için benim seçtiğim en sıkı kurallar)
- Supabase'in `anon`/`authenticated` rollerine varsayılan olarak verdiği **tüm** tablo ve fonksiyon
  yetkileri geri alındı; gereken her yetki tek tek, çoğu **sütun bazında** verildi.
- 18 yaş kontrolü üç katmanda: form → `auth.users` tetikleyicisi (kayıt reddedilir) → `set_birth_date`.
  Google ile gelen biri 18 altı tarih girerse hesap **kalıcı kilitlenir** (tekrar deneyemez).
- Doğum tarihi hiçbir zaman başkasına dönmez; yalnızca yaş, o da kullanıcı izin verirse.
- Gizlilik ayarı kapalı alan **arama ve filtrede de kullanılamaz** (ör. semtini gizleyen kişi semt
  aramasında çıkmaz, yaşını gizleyen yaş filtresinde hiç çıkmaz → tahmin edilemez).
- "Flört" etiketi yalnızca **karşılıklı** flört seçmiş, **açık rıza** vermiş ve birbirinin cinsiyet
  tercihine uyan kişilere görünür. Rıza zamanı istemciden değil sunucu saatinden yazılır; flört
  bırakılınca rıza ve tercih silinir.
- Hız sınırları: dakikada 30 mesaj, günde 20 mesaj isteği, günde 10 şikâyet.
- Reddedilen istek: gönderen bunu öğrenmez ("bekliyor" görünür) ve aynı kişiye tekrar istek atamaz.
- Engel: sohbet iki taraftan da gizlenir, iki yönde de mesaj/istek gönderilemez, bekleyen istekler kapanır.
- Tüm SECURITY DEFINER fonksiyonlarda `search_path = ''` (test bunu otomatik denetliyor).
- Realtime: `messages` ve `message_requests` yayına eklendi; Supabase Realtime RLS'e uyduğu için
  herkes yalnızca görebildiği satırların olaylarını alır.

### Testler
`npm run test:db` → PGlite (WASM Postgres) içinde Supabase ortamını taklit edip migration'ları uygular
ve 35 senaryoyu dener (anon erişimi, başkasının verisini okuma/yazma, sahte gönderen, engel, şikâyet,
flört kuralları, hız sınırları, fonksiyon yetkileri…). Testler yazarken iki gerçek hata yakaladı ve
düzeltildi (CHECK kısıtının yetki sorunu; kabul edilen isteğin "okunmamış" sayılması).

### Kararlar
- **Yakınımdakiler = aynı şehir** (aynı semt önce sıralanır). Koordinat/GPS saklanmıyor; tasarımdaki
  "tam konumun asla paylaşılmaz" ilkesine en uygun ve en güvenli seçenek.
- **Hobiler sabit katalogdan seçilir**, serbest metin yok (hakaret/spam etiketlerini önlemek için).
- **"Yalnızca ortak hobisi olanlar"** ayarında ortak hobisi olanlar da **istek** olarak yazar (doğrudan değil).
- Mesaj isteği ilk mesajı en çok 1000 karakter; sohbet mesajları 2000.
- "Çevrimiçi görün" varsayılanı **kapalı** (tasarım 10 ve 11'de de kapalı). Çevrimiçi = son 5 dk içinde aktif.

### Uygulanmadı (kapsam dışı ya da gizli anahtar gerektiriyor)
- Fotoğraf/sesli mesaj, anonim mesaj, arkadaşlık, harita, bildirimler — şema bunlara hazır değil, listede yoktu.
- Hesap silme ve şikâyet inceleme paneli **service_role (gizli anahtar)** gerektirir → atlandı.

### Migration'ları uygulamak (sabah, sen onaylarsan)
`supabase link --project-ref <ref>` → `supabase db push`, ya da SQL Editor'de üç dosyayı sırayla çalıştır.

## Adım 3 — Kayıt, giriş, şifre sıfırlama ✅

Sayfalar: `/signup`, `/login`, `/forgot-password`, `/reset-password` (+ `/en/...`), dönüş noktası `/auth/confirm`.
Mantık: `src/lib/auth/actions.ts` (Server Action'lar), doğrulama `src/lib/validation/auth.ts`.

- Kayıt: kullanıcı adı (müsaitlik RPC ile kontrol), e-posta, şifre (≥8, harf+rakam), doğum tarihi
  (GG.AA.YYYY maskeli, **Türkiye saatine göre 18 yaş**), cinsiyet (4 seçenek), koşullar onayı.
  Hatalar alan alan gösteriliyor; doğrulama e-postası ekranı var.
- Giriş: e-posta + şifre, "Beni hatırla" (işaretsizse çerezler tarayıcı kapanınca silinir),
  `?next=` ile kaldığı sayfaya döner (açık yönlendirmeye karşı yalnızca site içi yollar).
- Şifre sıfırlama: e-posta → bağlantı → `/reset-password` → yeni şifre.
- Google ile devam et: buton ve akış hazır.
- Tarayıcıda denendi: tüm alan hataları, tarih maskesi, TR/EN, korumalı sayfa yönlendirmesi.
  **Gerçek Supabase'e karşı uçtan uca denenemedi** (proje adresi yok).

### Kararlar
- **Giriş yalnızca e-posta ile.** Tasarımda "E-posta ya da kullanıcı adı" yazıyor; ama kullanıcı
  adından e-postayı bulmak ya (a) herkese açık bir "kullanıcı adı → e-posta" sorgusu (e-posta sızıntısı)
  ya da (b) **gizli service_role anahtarı** gerektiriyor. Talimat gereği atladım, etiketi "E-posta" yaptım.
- Hesap varlığını sızdırmamak için: kayıtlı e-postayla tekrar kayıtta da, şifre sıfırlamada da aynı
  "e-postanı kontrol et" mesajı gösteriliyor; giriş hatası her zaman "e-posta ya da şifre hatalı".
- Kayıtta cinsiyet için varsayılan seçili değil (tasarımda "Kadın" seçili görünüyor; bilinçli seçim istedim).
- Kullanım koşulları ve KVKK aydınlatma metni için `/legal/terms` ve `/legal/privacy` **yer tutucu** sayfalar.

### Sabah Supabase panelinde yapılması gerekenler
1. **Authentication → URL Configuration**: Site URL ve Redirect URL'lere `https://<alan-adın>/auth/confirm`
   (ve geliştirme için `http://localhost:3000/auth/confirm`) ekle.
2. **E-posta şablonları** (Authentication → Email Templates). Bağlantının başka cihazda açılınca da
   çalışması için:
   - *Confirm signup*: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Hesabımı doğrula</a>`
   - *Reset password*: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Şifremi sıfırla</a>`

   (`RedirectTo` zaten `.../auth/confirm?next=...` içeriyor; uygulama bunu gönderiyor. Varsayılan şablonla
   da `?code=` akışı çalışır, ama yalnızca kaydın yapıldığı tarayıcıda.)
3. **Google sağlayıcısı**: Google Cloud'da OAuth istemcisi oluşturup istemci kimliği/gizli anahtarını Supabase
   paneline gir. (Gizli anahtar uygulama koduna girmiyor.)
4. İstersen **Leaked password protection**'ı aç (hata mesajı hazır).

## Adım 4 — Başlangıç soruları ✅

Sayfa: `/onboarding` — `src/components/onboarding/wizard.tsx`, kayıt: `src/lib/onboarding/actions.ts`.

Adımlar (flört seçilirse 8, seçilmezse 7):
1. **Ne arıyorsun?** — 7 seçenek, çoklu seçim (tasarım 05).
2. **Flört tercihleri** *(yalnızca Flört seçildiyse)* — kimlerle tanışmak istiyor (Kadınlar / Erkekler / Diğer)
   + **KVKK açık rıza** onay kutusu. Rıza verilmeden flört kaydedilemiyor (veritabanı da reddediyor).
   "Flört'ü kaldır ve devam et" seçeneği var.
3. **Temel bilgiler** — görünen ad, kullanıcı adı, cinsiyet. Google ile gelenlerden ayrıca doğum tarihi
   ve koşullar onayı istenir (18 altıysa hesap kilitlenir, çıkış yaptırılır → `/account-blocked`).
4. **Konum** — 81 il listesinden şehir + serbest semt. Tam konum istenmiyor.
5. **Hobiler** — katalogdan 1–15 seçim, arama kutusu.
6. **Diller** — 18 dil (adlar tarayıcının diline göre otomatik çevrilir).
7. **Hakkında** — 500 karakter + isteğe bağlı okul/iş.
8. **Gizlilik** — Keşfet'te görün, yaş, semt, cinsiyet, çevrimiçi + "Kimler mesaj atabilir?".

- Her "Devam"da o adım veritabanına kaydedilir; sayfa yenilenirse **kaldığı ilk eksik adımdan** devam eder.
- Sağda canlı "Profilin böyle görünecek" önizleme kartı (masaüstü). Telefonda gizli, ilerleme çubuğu tek parça.
- Son adımda `onboarding_completed_at` yazılır; veritabanı zorunlu alanları son kez denetler → `/discover`.
- Başlangıcı bitirmeyen kullanıcı hiçbir sosyal özelliği kullanamaz (veritabanı seviyesinde).

### Kararlar
- Tasarımda "Adım 1 / 8" yazıyor; toplam adım sayısını **dinamik** yaptım (flörtsüz 7, flörtlü 8).
- Şehir **serbest metin değil, 81 il listesi**: "Yakınımdakiler" eşleşmesinin "istanbul / İstanbul / ist"
  gibi yazım farklarından bozulmaması için. Yurt dışındaki kullanıcılar için seçenek yok (sorulacak).
- Önizleme kartında "Arıyor" satırında **Flört gösterilmiyor** (zaten yalnızca uyumlu kişiler görecek).
- Profil fotoğrafı adımı yok (fotoğraf yükleme kapsam dışı; kartlarda baş harf avatarı kullanılıyor).

## Adım 5 — Keşfet ve kişi profili ✅

Sayfalar: `/discover`, `/u/<kullanıcı-adı>`. Uygulama kabuğu: `src/app/[locale]/(app)/layout.tsx`.

- **Uygulama kabuğu**: masaüstünde sol kenar çubuğu (Keşfet, Sohbetler + rozet, hesap menüsü: Profilim /
  Çıkış), telefonda alt gezinme (Keşfet, Sohbetler, Profil). Giriş yapmamış → `/login`, başlangıcı
  bitmemiş → `/onboarding`, 18 altı kilitli → bilgi ekranı (middleware'e ek ikinci kontrol).
- **Çevrimiçi sinyali**: sekme açıkken 2 dakikada bir `touch_presence` (yalnızca ayarı açık olanlar görünür).
- **Keşfet** (tasarım 06 / 12): Herkes, Yakınımdakiler, Ortak hobi, Çevrimiçi, Yaş aralığı filtreleri;
  isim/semt/hobi araması; ortak hobiler mercan, "N ortak hobi" ve "Çevrimiçi" rozetleri; "Daha fazla göster".
  Filtreler URL'de tutuluyor (paylaşılabilir, geri tuşu çalışır, JS'siz de çalışır).
- **Kişi profili** (tasarım 07 / 15): ad-yaş, çevrimiçi, semt, okul/iş, cinsiyet, "… beri Sohby'de",
  Arıyor etiketleri, Hakkında, Hobiler (ortaklar vurgulu), Diller, gizlilik notu.
  "Sohbeti başlatmak için bir fikir" kutusu ortak hobiye göre soru öneriyor; "Bu soruyla selam ver"
  mesaj penceresini hazır metinle açıyor.
- **Selam ver**: pencere içinden ilk mesaj → alıcının ayarına göre doğrudan sohbet (sohbete yönlendirir)
  ya da mesaj isteği ("İsteğin gönderildi"). Duruma göre buton "Sohbete git", "İsteği gör",
  "İstek gönderildi" ya da "yalnızca ortak hobisi olanlardan mesaj alıyor" olur.
- Keşfet kartındaki mesaj butonu profili mesaj penceresi açık olarak getiriyor.

### Kararlar
- Tasarımdaki **Harita, Bildirimler, Ayarlar** ikonlarını ve profildeki **Anonim yaz / Arkadaş ekle**
  butonlarıyla **Arkadaşları** kartını koymadım: bu gecenin listesinde yoklar, çalışmayan buton
  göstermek yerine gizlemeyi seçtim.
- Fotoğraf olmadığı için tasarımdaki siluetleri kullanıcıya özgü renkle çizdim; küçük fotoğraf şeridi yok.
- Profil sayfaları `noindex` (arama motorlarına kapalı); profiller yalnızca giriş yapmış kullanıcılara açık.
- Yaş filtresinde 18–99 seçiliyse filtre yok sayılıyor; aksi hâlde yaşını gizleyenler hiç görünmezdi.

## Adım 6 — Birebir mesajlaşma ✅

Sayfalar: `/chats` (liste), `/chats/<id>` (sohbet). Bileşenler: `src/components/chat/`.

- **Sohbet listesi** (tasarım 08 / 13): Sohbetler / İstekler sekmeleri (istek sayısı rozetli), arama,
  baş harfli avatar + çevrimiçi noktası, son mesaj ("Sen: …"), okunmamışlar kalın + mercan sayı,
  telefonda zaman etiketi (14:32 / Dün / Pzt).
- **Sohbet ekranı** (tasarım 08 / 14): başlık (ad, semt ya da "Çevrimiçi"), gün ayraçları (Bugün / Dün),
  balonlar (gelen: gece yüzeyi, giden: mercan), otomatik büyüyen yazma alanı, Enter ile gönder
  (Shift+Enter yeni satır), "Daha eski mesajlar" ile 50'şer geriye yükleme.
- **Anlık iletim**: Supabase Realtime `postgres_changes` (sohbet ekranı yalnızca o sohbeti, liste ve
  rozetler kullanıcının görebildiği tüm mesajları dinler; yetki RLS ile).
- **İyimser gönderim**: mesaj anında görünür; hata olursa sebebiyle ("çok hızlı", "gönderemezsin")
  ve "Tekrar dene" ile. Realtime ile çift görünme engellendi.
- **Okunmamış sayıları**: sohbet açıkken ve sekme görünürken `mark_conversation_read`; liste ve
  gezinme rozeti anında güncellenir. Engellenen ilişkide yazma alanı yerine bilgi notu çıkar.
- Telefonda sohbet ekranında alt gezinme gizlenir (tasarım 14).

### Kararlar / kapsam dışı
- Fotoğraf ve sesli mesaj butonları (tasarımda var) **eklenmedi**: görev "yazılı mesajlaşma".
- Sohbeti silme (çöp kutusu ikonu) eklenmedi: veritabanında "benden gizle" desteği yok, sabah konuşalım.
- "Okundu" bilgisi gösterilmiyor (ayarlar ekranıyla birlikte gelmeli: tasarımda "okundu bilgisi" ayarı var).
- Saatler next-intl üzerinden **Europe/Istanbul** saat dilimiyle gösteriliyor (sunucu/istemci uyumu için).

## Adım 7 — Mesaj istekleri ✅

Sayfalar: `/chats/requests` (liste), `/chats/requests/<id>` (ayrıntı).

- **İstek listesi** (tasarım 09 sol): açıklama metni, gönderen, "Flört" etiketi (flört isteğiyse),
  mesaj önizlemesi, göreli zaman (10 dk / 1 sa / Dün). Yeni istekler Realtime ile anında düşer.
- **Ayrıntı** (tasarım 09 sağ): ad-yaş, semt, "Profili gör", ortak hobiler ("ortak hobileriniz"),
  "10 dakika önce gönderildi" + mesaj, gizlilik notu, **Kabul et** / **Reddet**.
- **Kabul et** → sohbet açılır, ilk mesaj sohbete taşınır, doğrudan sohbet ekranına gidilir.
- **Reddet** → istek kapanır; gönderen bunu **öğrenmez** ve aynı kişiye tekrar istek atamaz.
- Profil sayfasında, bana istek atmış kişi için "İsteği gör" butonu çıkar. Ona benim yazmam,
  isteği otomatik kabul eder (veritabanı kuralı).

### Kararlar
- İstek ayrıntısındaki metin "…okuduğunu bilmez ve **seninle sohbete devam edemez**" oldu (tasarımda
  "fotoğraf ya da sesli mesaj gönderemez"; bu özellikler olmadığı için metni gerçeğe uydurdum).

## Adım 8 — Engelle ve şikâyet et ✅

Bileşen: `src/components/safety/safety-actions.tsx`, mantık: `src/lib/safety/actions.ts`.

- Üç yerde: **kişi profili** (masaüstü yazı bağlantıları, telefonda fotoğraf üstündeki ⋯ menü),
  **sohbet başlığı** (masaüstü çerçeveli butonlar — tasarım 08, telefonda ⋯ menü — tasarım 14),
  **mesaj isteği ayrıntısı** (yazı bağlantıları — tasarım 09).
- **Engelle**: onay penceresi (ne olacağı açıkça yazıyor; karşı taraf öğrenmez). Sonra Keşfet'e /
  sohbetlere / isteklere döner; sohbet iki taraftan gizlenir, bekleyen istekler kapanır.
- **Şikâyet et**: 8 neden (taciz, spam, uygunsuz içerik, sahte profil, 18 yaş altı, dolandırıcılık,
  nefret söylemi, diğer), isteğe bağlı not (1000 karakter), **"Ayrıca engelle"** seçeneği.
  Sohbetten ya da istekten açıldıysa o sohbet/istek şikâyete bağlam olarak eklenir (veritabanı,
  bağlamın gerçekten iki kişi arasında olduğunu doğruluyor). Günde en çok 10 şikâyet.

### Kararlar
- **"Ayrıca engelle" varsayılan olarak işaretli** (güvenli seçenek); kullanıcı kaldırabilir.
- Şikâyetler veritabanında `status = 'open'` ile birikiyor. **İnceleme paneli yok**: şikâyetleri okumak
  ve işlem yapmak service_role (gizli anahtar) gerektiriyor → atlandı. Şimdilik Supabase panelinden
  `reports` tablosuna bakılabilir.
- Engellenenler listesi (Ayarlar > Engellenenler) ve engeli kaldırma arayüzü yok (ayarlar ekranı listede yoktu);
  veritabanı tarafı (`get_blocked_users`, `unblock_user`) hazır.

## Adım 9 — Tanıtım sayfası ✅

Sayfa: `/` (ve `/en`). Tasarım 02'ye birebir yakın: üst çubuk (Nasıl çalışır, TR/EN, Giriş yap, Katıl),
"Bu akşam kiminle muhabbet?" başlığı, e-posta kutusu + "Hemen katıl" (e-postayı kayıt formuna taşır),
18 yaş notu, örnek profil kapsülleri, "Üç adım, bir selam." bölümü, üç özellik, alt bilgi.

- Alt bilgideki **Gizlilik politikası, KVKK aydınlatma metni, İletişim** yer tutucu sayfalara gidiyor.
- Örnek profiller (Elif, Mert, Zeynep, Can) tasarımdaki gibi sabit metin; gerçek kullanıcı değil.
