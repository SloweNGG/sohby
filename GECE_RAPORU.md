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

## Sonradan: CLAUDE.md uyum kontrolü (7 Kasım, sabah)

CLAUDE.md eklendi; 15 güvenlik kuralı migration'larla tek tek karşılaştırıldı. Düzeltmeler
`supabase/migrations/20261107000400_claude_md_security.sql` dosyasında, testleri
`supabase/tests/claude-md.test.mjs` içinde. `npm test` → 47/47.

| # | Kural | Durum |
| --- | --- | --- |
| 1 | Her tabloda RLS, istemciye güvenme | ✅ Uyuyordu |
| 2 | service_role yalnızca Edge Function'da | ✅ Uyuyordu (artık testle denetleniyor) |
| 3 | Mesajları yalnızca iki katılımcı okur | ✅ Uyuyordu |
| 4 | Medya gizli bucket + imzalı bağlantı | ⏭ İleride (fotoğraf/ses yok) |
| 5 | Medya izni sunucuda kontrol | ⏭ İleride |
| 6 | Engellenen mesaj gönderemez, Keşfet'te görmez | ✅ Uyuyordu (harita ileride) |
| 7 | Önce istek: kabule kadar tek mesaj | ✅ Uyuyordu (medya ileride) |
| 8 | Günde 20 yeni kişiye ilk mesaj | 🔧 Düzeltildi: doğrudan sohbetler de sayılıyor (anonim sınırı ileride) |
| 9 | 18 yaş + e-posta doğrulanmadan mesaj yok | 🔧 Düzeltildi: e-posta doğrulaması veritabanında kontrol ediliyor |
| 10 | Anonim sohbette kimlik sızmaz | ⏭ İleride (anonim sohbet yok) |
| 11 | Flört ilgi bilgisi ayrı tablo, kimse okuyamaz | 🔧 Düzeltildi: `private.dating_preferences`, sahibi dahil okunamaz |
| 12 | Konum yalnızca semt düzeyi | ✅ Uyuyordu (artık testle denetleniyor) |
| 13 | Sohbet silme yalnızca kendi görünümünden; mesaj saklanır | 🔧 Kısmen: hesap silinince mesajlar artık yok olmuyor; sohbet silme özelliği ileride |
| 14 | Yönetici işlemleri silinemez kayıtta | ⏭ İleride (yönetim paneli yok) |
| 15 | Yaş doğrulama belgeleri | ⏭ İleride |


---

# Gece 2 — 7 Kasım 2026

## Gece 2 — Sabah özeti

**11 işin 11'i bitti**, her biri ayrı commit (`git log`). **12 migration uzak veritabanında** (her biri önce
`--dry-run`, sonra `--remote --yes`); iki Edge Function yayında (`purge-underage-accounts`,
`upload-profile-photo`). **Cloudflare'e hiçbir şey yüklenmedi.** Gizli anahtar hiçbir dosyada yok (tarandı).

Doğrulama: `npm test` → **121/121** (veritabanı/RLS, CLAUDE.md kuralları, anonimlik, saklama, yönetim,
Edge Function'lar, çeviri ve palet korumaları), `tsc` + ESLint temiz, ana uygulama ve yönetim paneli
`opennextjs-cloudflare build` ile paketleniyor.

**Gerçek kullanıcıyla tarayıcıdan uçtan uca denenmedi**: kayıt e-postası, giriş, fotoğraf yükleme, Realtime.
Veritabanı mantığı gerçek Postgres'te test edildi; uzakta salt okunur kontroller yapıldı.

### CLAUDE.md güvenlik kuralları — son durum
| # | Kural | Durum |
| --- | --- | --- |
| 1 | RLS her tabloda, istemciye güven yok | ✅ (uzakta 10/10 + yeni tablolar; testli) |
| 2 | service_role yalnızca Edge Function'da | ✅ (testle taranıyor) |
| 3 | Mesajları yalnızca iki katılımcı okur | ✅ |
| 4 | Medya gizli bucket + kısa ömürlü imzalı bağlantı | ✅ profil fotoğrafı · ⏭ sohbet medyası 2. aşama |
| 5 | Medya izni sunucuda | ⏭ 2. aşama (sohbet medyası yok) |
| 6 | Engellenen yazamaz, engelleyeni göremez | ✅ (harita 2. aşama) |
| 7 | Önce istek: kabule kadar tek mesaj, medya yok | ✅ (normal + anonim) |
| 8 | Günde 20 yeni kişi, anonimde daha düşük | ✅ (20 toplam, anonim 5) |
| 9 | 18 yaş + e-posta doğrulanmadan mesaj yok | ✅ (18 altı Google kaydı saatlik görevle silinir) |
| 10 | Anonimde kimlik hiçbir yanıtta sızmaz; engel/şikâyet gerçek hesaba | ✅ (13 test + yan kanal önlemi) |
| 11 | Flört ilgisi ayrı tablo, kimse okuyamaz, rıza geri çekilince silinir | ✅ |
| 12 | Konum yalnızca semt; GPS yok | ✅ (fotoğraflardaki GPS de siliniyor) |
| 13 | Sohbet silme yalnızca kendi görünümünden; mesajlar saklanır | ✅ (90 gün kararıyla) |
| 14 | Yönetici işlemleri ve sohbet görüntüleme silinemez kayıtta | ✅ |
| 15 | Yaş doğrulama belgeleri şifreli, 30 gün | ⏭ belge yükleme henüz yok |

### Sabah senden gerekenler (öncelik sırasıyla)
1. **Kendini yönetici yap** (SQL Editor): `insert into private.admins (user_id) select id from auth.users where email = 'SENİN-E-POSTAN';`
   (önce ana uygulamadan kayıt olman gerekiyor).
2. **Supabase paneli**: yönlendirme adresleri ve e-posta şablonları (Gece 1, Adım 3 sonundaki liste), Google sağlayıcısı.
3. **Turnstile ve Sentry anahtarları** (İş 11'deki adımlar). Turnstile gizli anahtarı yalnızca Supabase paneline.
4. `admin/.env.local` oluştur (iki değer, ana uygulamadakiyle aynı) ve Cloudflare Access ile admin.sohbyapp.com'u koru.
5. Tarayıcıdan uçtan uca dene: iki hesap aç → başlangıç soruları → Keşfet → istek → kabul → anlık mesaj →
   fotoğraf yükle → anonim yaz → engelle/şikâyet et → panelden incele.

### Sormak istediklerim
- Anonim sohbetlerde de "sohbeti sil" olsun mu? (Şu an yalnızca normal sohbetlerde.)
- Yaş doğrulama belgesi yükleme (kural 15) bir sonraki adım olsun mu? Şifreleme için anahtar yönetimi
  (ör. Supabase Vault) kararı gerekiyor.
- Reddedilen istekte "kalıcı olarak bir daha istek atamaz" kuralı (Gece 1 sorusu) hâlâ açık.

> Kurallar: onay beklenmedi; kararsız kalınan yerde en güvenli seçenek seçilip burada not edildi.
> Uzak veritabanına her migration önce `--dry-run` ile denendi, sonra uygulandı. Cloudflare'e yükleme yapılmadı.

| # | İş | Durum |
| --- | --- | --- |
| 1 | 3 kararın uygulanması + migration'ların uzak veritabanına uygulanması | ✅ |
| 2 | CLAUDE.md farkları: renkler, gömülü metinler, EN çeviriler | ✅ |
| 3 | Profil düzenleme + profil fotoğrafı (gizli bucket, imzalı bağlantı) | ✅ (gerçek yükleme tarayıcıdan denenmedi) |
| 4 | Gizlilik ayarları | ✅ |
| 5 | Flört | ✅ |
| 6 | Anonim sohbet | ✅ |
| 7 | Sohbet silme, tümünü sil, tümünü okundu işaretle | ✅ |
| 8 | Hesap durumu ekranları + itiraz | ✅ (yaş belgesi yükleme ileride) |
| 9 | Yönetim paneli (ayrı uygulama) | ✅ (henüz yönetici hesabı yok) |
| 10 | Menü: yalnızca çalışan sayfalar | ✅ |
| 11 | Turnstile ve Sentry (kod hazır, anahtarlar boş) | ✅ |

## İş 1 — Kararlar ve uzak veritabanı ✅

### Kararların uygulanması
- **90 gün saklama** (`20261107000500_retention_and_underage_purge.sql`):
  - Hesabını silen kişi (`delete_my_account`) hemen görünmez olur, mesaj gönderemez/alamaz; flört
    tercihi hemen silinir; verileri 90 gün sonra kalıcı silinir.
  - Açık (open/reviewing) şikâyeti olan kişinin/sohbetin verileri şikâyet kapanana kadar silinmez.
  - "Kendi görünümünden silinen sohbetler" için 90 gün kuralı, sohbet silme özelliğiyle (iş 7) eklenecek.
- **18 yaş altı Google kaydı**: hesap hemen kilitleniyor (zaten vardı); her saat başı çalışan görev
  (`pg_cron`, `sohby-purge-underage`) kilitli hesapları **tamamen siliyor** → en geç ~1 saatte silinir.
  Ayrıca günlük temizlik görevi (`sohby-purge-expired`, 03:23).
- **Edge Function** `purge-underage-accounts` yazıldı, test edildi (5 test) ve **Supabase'e yüklendi**.
  Yalnızca service_role anahtarıyla çağrılabiliyor; uzakta anahtarsız / publishable anahtarlı çağrıların
  403 ile reddedildiği doğrulandı.

### Karar: silme işini asıl olarak veritabanı görevi yapıyor
Edge Function'ı zamanlı çağırmak için service_role anahtarının veritabanı kasasına (Vault) yazılması
gerekiyor; gizli anahtarı hiçbir yere yazmamam gerektiği için bunu yapmadım. "24 saat içinde silme"
garantisi bu yüzden aynı işi yapan saatlik veritabanı görevine dayanıyor (gizli anahtar gerektirmiyor).
Edge Function, Auth yönetici API'siyle aynı işi yapıyor; istersen Vault'a anahtarı ekleyip zamanlayıcıyı
ona bağlayabiliriz (sabah 5 dakikalık iş).

### Uzak veritabanı
`npx supabase db push --dry-run` çıktısı (CLI 3.0, varsayılanı yerel olduğu için `--remote` eklendi):
```
Target: project sohbymain (vujwonanevmcmejwbseo) · production
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20261107000100_profiles_and_hobbies.sql
 • 20261107000200_messaging.sql
 • 20261107000300_discover_safety.sql
 • 20261107000400_claude_md_security.sql
 • 20261107000500_retention_and_underage_purge.sql
```
> Not: Bu çıktı eski (Mumbai) projeye aitti. Proje 7 Kasım'da yeni projeye taşındı; bkz. "Taşıma" bölümü.
Sorun yoktu → `npx supabase db push --remote --yes` ile uygulandı (CLI ajan modunda `--yes` istiyor;
onayın mesajındaydı). 5 migration da başarılı.

Salt okunur kontroller (uzakta):
- Hobi kataloğu giriş yapmadan okunabiliyor: **48** kayıt.
- Giriş yapmadan profiles, profile_private, messages, conversations, message_requests, blocks, reports
  → **hepsi reddedildi** (42501).
- `discover_profiles` ve `underage_accounts_due` giriş yapmadan çağrılamıyor; `username_available` çalışıyor.
- `private.dating_preferences` API'ye hiç açık değil.
- 10 tablonun **10'unda RLS açık**; iki zamanlanmış görev kurulu ve aktif.
- `supabase migration list --remote`: yerel ve uzak 5/5 eşleşiyor.

Testler: 57/57 (veritabanı, saklama, Edge Function, birim).

## İş 2 — CLAUDE.md tasarım ve metin farkları ✅

- **Renkler** birebir CLAUDE.md paletine çekildi (`src/app/globals.css`, açıklamalı). Palet dışı 6 ton
  kaldırıldı (eski "gece" #1E1133, daha koyu panel, yumuşak çizgi, soluk-ötesi gri, koyu mercan, hover mercanı).
  - Alan ve ikincil düğme kenarları artık **cerceve** (#4A3675), ayırıcılar **cizgi** (#3D2A63).
  - Koyu zemindeki mercan tonlu yazılar (Şikâyet et, hata, adım etiketi…) **mercan-yazi** (#FF8A7A).
  - **Yeşil yalnızca çevrimiçi**: "gönderildi/şikâyet alındı" ikonları ve başarı kutusu lilaya çevrildi.
  - Avatarlar ve siluetler paletten türetiliyor (lila ağırlıklı).
  - Yazı ağırlıkları: gövde 400 (önce 300'dü), başlıklar 800.
  - Giriş alanları 16px köşe (arama kutuları ve mesaj yazma alanı tam yuvarlaktı).
- **Koda gömülü metinler** `messages/*.json`'a taşındı (marka adı, logo yazısı, "Sohby ana sayfa"
  bağlantı etiketleri, tarih yer tutucusu, "Türkiye", tanıtım sayfasındaki örnek profiller, TR/EN kodları).
  EN karşılıkları eksiksiz.
- **Kalıcı korumalar (testler):** `.tsx` içinde düz metin / Türkçe dize / metinli öznitelik yakalayan test,
  TR-EN anahtar eşitliği + boş değer testi, palet dışı renk testi. `npm test` → 60/60.

### Kararlar
- Tanıtım sayfasının açık bölümündeki "01-02-03" numaraları tasarımda mercan; ama mercan açık zeminde
  kontrastı 2.5:1 (CLAUDE.md en az 4.5:1 istiyor) → **gece renginde** gösteriliyor.
- Arama kutuları tasarımda tam yuvarlak; CLAUDE.md "giriş alanları 16px" dediği için 16px yapıldı.

## İş 3 — Profil düzenleme ve profil fotoğrafı ✅

Sayfa: `/profile/edit` (tasarım 10; kendi profilinde "Profili düzenle"). Migration 6 uzağa uygulandı
(dry-run → push), Edge Function `upload-profile-photo` yayında.

- **Düzenleme**: görünen ad, şehir (81 il), semt, okul/iş, cinsiyet, hakkında, hobiler (kaldır ×, "Ekle"
  ile aranabilir liste, en çok 15), "Profilimde görünsün" (yaş, semt, çevrimiçi), canlı önizleme kartı.
- **Fotoğraf güvenliği**:
  - Gizli bucket `profile-photos` (5 MB, yalnızca JPEG/PNG/WebP). Kullanıcıların bucket'a **yazma izni yok**;
    tek yol Edge Function. Fonksiyon: oturum belirtecini Supabase Auth'ta doğrular, türü **baytlardan**
    belirler (".jpg" adlı SVG reddedilir), **EXIF/GPS/XMP/metin üst verilerini siler** (kural 12),
    kullanıcının kendi klasörüne yazar, veritabanı kaydı başarısızsa dosyayı geri siler.
  - Görüntüleme: sunucu **15 dakikalık imzalı bağlantı** üretir; storage RLS bağlantıyı yalnızca profili
    görmeye yetkili kişilere verir (engelli, gizli profil, giriş yapmamış → yok).
  - **Otomatik onay varsayılan açık** (`private.app_settings`); kapalıyken fotoğraf "inceleniyor" kalır
    ve sahibi dışında kimse göremez. Günde en çok 10 yükleme. Yeni fotoğraf eskisini siler.
  - Fotoğraflar Keşfet kartlarında ve kişi profilinde gösteriliyor (yoksa siluet).
- Testler: 8 fotoğraf erişim testi + 5 üst veri temizleme testi + 6 yükleme fonksiyonu testi. `npm test` → 77/77.
- Uzakta doğrulandı: bucket gizli, 5 MB, 1 okuma politikası / 0 yazma politikası; fonksiyon anahtarsız
  ve publishable anahtarla çağrıyı 401 ile reddediyor.

### Kararlar
- Fotoğraf tarayıcıda 1600 px'e küçültülüp yeniden kodlanıyor (hız için); güvenlik kontrolleri yine de
  sunucuda yapılıyor, tarayıcıya güvenilmiyor.
- Testi sırasında bulunan hata: günlük yükleme sınırı her yeni yükleme eskisini sildiği için hiç
  dolmuyordu → yüklemeler ayrı bir sayaç tablosunda sayılıyor.
- Sohbet listesindeki küçük avatarlar şimdilik baş harfli (fotoğraf yalnızca kart ve profilde).

## İş 4 — Gizlilik ayarları ✅

Sayfa: `/settings` (tasarım 11'in çalışan bölümleri). Migration 7 uzağa uygulandı (dry-run → push).

- **Kimler mesaj atabilir** (herkes / önce istek / yalnızca ortak hobi).
- **Profilde görünenler**: Keşfet'te görün, yaş, semt, cinsiyet, çevrimiçi durumu.
- **Okundu bilgisi**: karşılıklı — iki taraf da açıksa sohbette son mesajın altında "Okundu" çıkar
  (20 saniyede bir tazelenir); biri kapatırsa iki taraf da göremez. Ham okuma zamanları Realtime'a
  hiç verilmiyor (test var).
- **Anonim mesajları kabul et** (varsayılan açık; iş 6'da kullanılıyor).
- **Uygulama dili** (Türkçe / English): kaydedilir, hemen uygulanır ve girişte otomatik seçilir.
- **Engellenen kişiler** listesi ve "Engeli kaldır".
- **Hesabımı sil**: onay penceresi → hesap hemen kapanır, oturum sonlanır, veriler 90 gün sonra silinir.
- Testler: okundu bilgisi karşılıklılığı, ayarları yalnızca sahibinin değiştirmesi, dil kısıtı. `npm test` → 80/80.

### Kapsam dışı bırakılanlar (tasarım 11'de var)
Haritada görün, arkadaş listem, fotoğraf/sesli mesaj izinleri, gelen fotoğrafları gizle, şikâyetlerim,
verilerimi indir, bildirimler — hepsi 2. aşama özelliklerine bağlı; çalışmayan seçenek göstermedim.

## İş 5 — Flört ✅

Migration 8 uzağa uygulandı (dry-run → push).

- **Yalnızca birbirini flört amacıyla görme**: Keşfet'te "Flört" filtresi yalnızca flört seçmiş kişiye
  görünür ve yalnızca **karşılıklı uyumlu** kişileri döndürür (ikisi de flört seçmiş + açık rıza + birbirinin
  ilgilendiği cinsiyete uyuyor). Flört seçmemiş biri filtreyi API'den çağırsa bile reddedilir.
- **Eşleştirme** yalnızca `private.dating_preferences`'tan; hiçbir yanıtta ilgi tercihi yok (test var).
- **Kartta "Flört" etiketi** yalnızca uyumlu izleyene görünür.
- **Flört etiketli mesaj isteği**: profilde "Flört isteği olarak gönder" seçeneği yalnızca karşılıklı
  uyumluysanız çıkar; flört istekleri alıcının ayarı "herkes" olsa bile her zaman **istek** olarak gider ve
  istek listesinde "Flört" etiketiyle görünür.
- **Ayarlar > Flört**: aç (ilgi + açık rıza), tercihi güncelle, kapat ve rızayı geri çek (tercih hemen silinir).
- Testler: 5 yeni flört testi. `npm test` → 86/86.

### Karar
- İlgi tercihi sahibine de geri gösterilmediği için (kural 11) "güncelle" ekranında seçimler boş başlıyor;
  kullanıcı yeniden seçiyor.

## İş 6 — Anonim sohbet ✅

Migration 9 uzağa uygulandı (dry-run → push). Sayfa: `/chats/anon/<id>`; profilde "Anonim yaz".

**Nasıl çalışıyor**
- "Anonim yaz" → mesaj her zaman **istek** olarak gider; kabul edilene kadar tek mesaj. Alıcı yalnızca
  rastgele bir **takma ad** görür ("Gizli Tilki" / "Secret Fox"; iki dilde çevrilir).
- Alıcı kabul edince sohbet açılır. Alıcı **"Kimliğini açmasını iste"**; anonim taraf **"Kimliğini aç"**
  (onaylı) → bütün mesajlar gerçek kimlikle normal sohbete taşınır.
- Alıcı ayarlardan "Anonim mesajları kabul et"i kapatabilir. Zaten tanıştığın (sohbet/istek olan) kişiye
  anonim yazılamaz. Günde en çok 5 yeni anonim sohbet (20 yeni kişi sınırına da sayılır). E-posta doğrulaması şart.

**Kimlik sızmaması (kural 10) — nasıl sağlandı**
- Anonim sohbetler ayrı tablolarda. Alıcının okuyabildiği satırlarda (`anon_conversations`,
  `anon_messages`, Realtime yükleri) **gönderen kimliği hiç yok**; mesajlarda yalnızca "anonim taraftan mı".
  Gerçek gönderen yalnızca API'ye kapalı `private.anon_senders` tablosunda.
- Engel: gerçek hesaba işler (gönderen alıcıya hiçbir yoldan ulaşamaz, onu göremez). Alıcının engellenenler
  listesinde ve engel tablosunda kimlik değil takma ad görünür.
- Şikâyet: gerçek hesaba işler (yönetici görür). Şikâyet eden `reported_id` sütununu **okuyamaz**
  (normal şikâyetlerde de; sütun düzeyinde yetki kaldırıldı).
- **Dolaylı sızıntı önlemi:** normal engel çift yönlü; ama anonim sohbetten yapılan engel yalnızca engelleneni
  kısıtlıyor. Aksi hâlde alıcı "engelledikten sonra Keşfet'imden / sohbetlerimden kim kayboldu?" diye bakıp
  kimliği çıkarabilirdi. Testle doğrulandı: engelleyenin Keşfet'i değişmiyor.
- Reddedilen anonim istek göndericiye "bekliyor" görünür.
- Testler: 13 anonim sohbet testi (alıcının erişebildiği 7 farklı yanıtta gönderenin id/kullanıcı adı/adı
  aranıyor). `npm test` → 99/99.

### Kararlar / bilinen sınırlar
- Yeni anonim istekler Realtime ile anlık gelmez (kimlik taşıyan satır yayınlamamak için); rozetler dakikada
  bir ve sekmeye dönüşte tazelenir. Mesajlar ise anlık.
- Anonim sohbette "okundu bilgisi" yok.
- Yan kanal kontrolü: anonim engelden sonra engelleyen o kişiye normal yoldan yazmayı denese bile farklı bir
  tepki almıyor (testle doğrulandı), bu yüzden bilinen bir "deneyerek bulma" yolu kalmadı. Yine de anonimlik,
  bir güvenlik incelemesinde ayrıca gözden geçirilmeli.

## İş 7 — Sohbet silme ve toplu işlemler ✅

Migration 10 uzağa uygulandı (dry-run → push).

- **Sohbeti sil** (sohbet başlığındaki çöp kutusu, tasarım 08): onay penceresi → sohbet **yalnızca senin
  görünümünden** silinir. Silen kişi eski mesajları API'den de göremez (RLS), karşı taraf görmeye devam eder.
  Yeni mesaj gelirse sohbet yalnızca yeni mesajlarla geri gelir.
- **Sohbet listesi "⋯" menüsü**: "Tümünü okundu işaretle" (normal + anonim) ve "Tüm sohbetleri sil" (onaylı).
- **90 gün kararı**: bir mesaj **iki tarafın da** görünümünden silinmişse ve son silmenin üzerinden 90 gün
  geçtiyse günlük görevde kalıcı silinir; açık şikâyet varsa beklenir.
- Testler: 6 yeni test. Test yazarken bir hata yakalandı: erişim kuralında nitelenmemiş `created_at` sohbetin
  tarihine çözülüyordu → düzeltildi. `npm test` → 105/105.

### Kararlar
- Yalnızca bir taraf sildiyse mesajlar kalıcı silinmiyor (karşı tarafın verisi). Silen kişiye zaten görünmüyor.
- Anonim sohbetlerde "sil" yok (şimdilik yalnızca "okundu işaretle" kapsıyor).

## İş 8 — Hesap durumları ve itiraz ✅

Migration 11 uzağa uygulandı (dry-run → push).

- Yeni durumlar: **yaş doğrulaması istendi**, **askıya alındı** (süreli olabilir; süre dolunca kendiliğinden
  kalkar), **kalıcı kapatıldı**. Ayrıca kullanıcının kendi sildiği hesap için "hesabını sildin" ekranı.
- Bu durumlardaki kullanıcı **uygulamanın hiçbir sayfasına geçemez** (uygulama kabuğu ve başlangıç soruları
  durum ekranını gösterir) ve **veritabanı da engeller**: "aktif kullanıcı" kontrolü artık durumu denetliyor →
  Keşfet, mesaj, istek, anonim yazma, fotoğraf görüntüleme kapalı; başkalarının Keşfet'inde de görünmez.
- **İtiraz formu**: 10–2000 karakter, aynı anda tek açık itiraz, 7 günde en çok 3; kullanıcı yalnızca kendi
  itirazını görür ve değiştiremez. Ekranda "itirazın inceleniyor / reddedildi" durumu.
- Kullanıcı kendi durumunu değiştiremez (yalnızca yönetim — iş 9).
- Testler: 6 yeni test. `npm test` → 111/111.

### İleride
- **Yaş doğrulama belgesi yükleme** (kural 15: şifreli, ayrı bucket, inceleme sonrası en geç 30 gün içinde
  silme). Şu an "yaş doğrulaması istendi" ekranı itiraz/açıklama mesajıyla çalışıyor.

## İş 9 — Yönetim paneli ✅

Ayrı uygulama: `admin/` (Next.js, Cloudflare Workers adı `sohby-admin`, admin.sohbyapp.com için).
Migration 12 uzağa uygulandı (dry-run → push). **Yayına alınmadı.**

- **Yetki**: yöneticiler veritabanında `private.admins` tablosunda (API'ye kapalı). Panel **gizli anahtar
  kullanmaz**; normal oturumla `admin_*` fonksiyonlarını çağırır ve her fonksiyon yönetici rolünü kendisi
  denetler. Yönetici olmayan hesap girişte reddedilir/çıkış yaptırılır; API'den çağırsa da "forbidden".
- **Silinemez işlem kaydı (kural 14)**: her yönetim işlemi (listeleme dahil) ve **her sohbet görüntüleme**
  aynı işlem içinde `private.admin_audit_log`'a yazılır. Tablo UPDATE/DELETE/TRUNCATE'i tetikleyiciyle
  reddeder (veritabanı sahibi bile). Panelde "İşlem kaydı" sayfası var.
- **Şikâyet kuyruğu**: açık/tümü; ayrıntıda şikâyet notu ve ilgili sohbet (normal, anonim — yönetici gerçek
  kimliği görür —, ya da mesaj isteği); İncelemeye al / Çözüldü / Geçersiz; 7 gün askıya al / hesabı kapat.
- **Fotoğraf onayı**: otomatik onay anahtarı (**varsayılan açık**), bekleyen fotoğraflar 5 dakikalık imzalı
  bağlantıyla; onayla / reddet.
- **Kullanıcılar**: arama (kullanıcı adı, ad, e-posta), durum filtresi, durum değiştirme (gerekçe + askı bitişi).
- **İtirazlar**: kabul (hesap açılır) / ret.
- Güvenlik başlıkları: noindex, no-store, çerçeveleme yok, katı çerez (SameSite=Strict).
- Testler: 6 yönetim testi (yetkisiz erişim, kayıt yazımı, kaydın değiştirilemezliği, etkiler). `npm test` → 117/117.

### Sabah yapman gerekenler (panel için)
1. **Kendini yönetici yap** (SQL Editor, bir kez):
   `insert into private.admins (user_id) select id from auth.users where email = 'SENİN-E-POSTAN';`
2. `admin/.env.local` oluştur: `.env.example`'daki iki değeri ana uygulamadaki gibi doldur (gizli anahtar yok).
   Yerelde: `cd admin && npm run dev` → http://localhost:3001
3. Yayında **Cloudflare Access** ile admin.sohbyapp.com'u yalnızca senin e-postana aç (Zero Trust → Access →
   Applications). Veritabanı zaten korumalı; Access ikinci katman.

## İş 10 — Menü ✅

- Masaüstü kenar çubuğu: **Keşfet, Sohbetler (rozetli), Ayarlar** + profil menüsü (**Profilim, Profili düzenle,
  Çıkış**). Telefon alt menüsü: **Keşfet, Sohbetler, Ayarlar, Profil** (4 sekme).
- CLAUDE.md'deki **Harita** ve **Bildirimler** 2. aşamada; çalışmadıkları için menüde yoklar.
- Menü tek bir listeden (`src/components/app/nav-items.ts`) üretiliyor; test her menü öğesinin gerçekten var
  olan bir sayfaya gittiğini denetliyor (ileride sayfası olmayan bir düğme eklenirse test kırılır).
- Düzeltme: başkasının profilindeyken "Profil" sekmesi seçili görünüyordu; artık Keşfet seçili.

## İş 11 — Turnstile ve Sentry ✅ (anahtarlar boş)

- **Turnstile**: kayıt, giriş ve şifre sıfırlama formlarında. Supabase Auth'un yerleşik CAPTCHA desteği
  kullanılıyor: form belirteci Supabase'e iletiyor, **doğrulamayı Supabase yapıyor** → Turnstile'ın gizli
  anahtarı uygulamaya hiç girmiyor. Site anahtarı boşken widget görünmüyor ve akış eskisi gibi çalışıyor.
- **Sentry**: istemci + sunucu hata takibi, yalnızca DSN tanımlıysa açılıyor. **Kişisel veri gönderilmiyor**
  (istek gövdesi, çerezler, başlıklar, kullanıcı bilgisi, ayrıntılar silinir; oturum kaydı kapalı) — testle doğrulandı.
- `.env.local`'e boş değişkenler eklendi: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (açıklamaları `.env.example`'da).

### Anahtarları nereden alacaksın
1. **Turnstile site anahtarı** → Cloudflare paneli → **Turnstile** → *Add widget* → alan adları: `sohbyapp.com`
   (ve geliştirme için `localhost`) → *Site Key*'i `NEXT_PUBLIC_TURNSTILE_SITE_KEY`'e yaz.
   **Secret Key**'i dosyaya değil, Supabase paneli → **Authentication → Attack Protection (Bot and Abuse
   Protection)** → *Enable CAPTCHA protection* → sağlayıcı **Turnstile** → gizli anahtarı oraya yapıştır.
   ⚠️ Supabase'te CAPTCHA'yı açtığın anda site anahtarı da tanımlı olmalı; yoksa kayıt/giriş reddedilir.
2. **Sentry DSN** → sentry.io → yeni proje (platform: Next.js) → *Settings → Client Keys (DSN)* →
   `NEXT_PUBLIC_SENTRY_DSN`'e yaz. Kaynak haritası yükleme (gizli auth token gerektirir) yapılandırılmadı.
3. Cloudflare'de yayına alırken bu `NEXT_PUBLIC_*` değerleri **derleme ortamına** da girilmeli (derleme
   sırasında koda gömülürler).

---

# Taşıma — yeni Supabase projesi (7 Kasım 2026)

Eski proje (Mumbai, `vujwonanevmcmejwbseo`) yerine yeni boş proje: **sohbymain** (`skjibnltlwskndjfxqij`).

## Yapılanlar
1. `.env.local` (ana uygulama): Supabase adresi ve publishable anahtar yenilendi. `admin/.env.local` yoktu;
   aynı iki değer ve `ADMIN_LOCALE=tr` ile **oluşturuldu**. İkisi de `.gitignore`'da (doğrulandı).
2. `npx supabase projects list` → `skjibnltlwskndjfxqij` **linked: true**. ⚠️ Bölge `eu-west-1` (İrlanda)
   görünüyor, Frankfurt (`eu-central-1`) değil.
3. Migration'lar: `db push --dry-run --remote` → 12 migration uygulanacak; ardından `db push --remote --yes`
   → **12/12 hatasız** uygulandı.
4. Edge Function'lar yayınlandı: `purge-underage-accounts`, `upload-profile-photo`. Yalnızca Supabase'in
   otomatik verdiği `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` kullanılıyor; ayrıca girilecek sır yok.
5. Eski proje kodu: kod, ayar dosyaları ve README'de **iz yoktu** (adres hep `.env.local`'den okunuyor).
   Tek iz bu rapordaki dünkü prova çıktısı; geçmiş kaydı değiştirmedim, altına not düştüm. Eski adresi
   gömülü taşıyan derleme çıktıları (`.next`, `.open-next`, admin'deki eşleri) silinip yeniden derlendi.
6. Salt okunur kontroller (yeni projede):
   - RLS: `public` 13/13, `private` 6/6 tabloda açık; RLS'si kapalı tablo yok.
   - Hobi kataloğu: 48 kayıt. Zamanlanmış görevler: `sohby-purge-underage`, `sohby-purge-expired`.
   - `profile-photos` bucket gizli, 5 MB; tek depolama kuralı yalnızca giriş yapmışlara okuma.
   - Giriş yapmamış ziyaretçi (yalnızca publishable anahtarla, gerçek API'ye): 12 kullanıcı tablosunun
     hepsi `permission denied`; `private` şema API'de yok; `discover_profiles`, `get_conversations`,
     `admin_*` vb. fonksiyonlar `permission denied`; Edge Function'lar 401/403. Açık olan tek şey hobi
     adları kataloğu (kişisel veri değil).
   - Realtime: `messages`, `message_requests`, `anon_messages`.
7. `npm test` → **121/121**. İki uygulama `opennextjs-cloudflare build` ile derlendi; kısa çalıştırmada
   `/`, `/en`, `/login`, `/signup` açılıyor, korumalı sayfalar girişe yönlendiriyor.

## Yeni projede panelde yeniden yapılacaklar
Eski projedeki kullanıcılar ve veriler **taşınmadı**; yeniden kayıt olman gerekiyor.
1. **Authentication → Sign In / Providers → Email**: *Confirm email* açık olsun (kural 9).
2. **Authentication → URL Configuration**: Site URL `https://sohbyapp.com`; Redirect URLs'e
   `https://sohbyapp.com/**` ve `http://localhost:3000/**`.
3. **Authentication → Emails → SMTP Settings** (Resend): host `smtp.resend.com`, port `465`, kullanıcı
   `resend`, şifre = Resend API anahtarı (yalnızca panele). Gönderen adres `sohbyapp.com` alan adından.
   Bu yapılmazsa Supabase'in yerleşik e-postası çok kısıtlı (saatte birkaç e-posta, yalnızca ekip üyelerine).
4. **Authentication → Emails → Templates**: *Confirm signup* ve *Reset password* bağlantıları
   (Gece 1, Adım 3 sonundaki şablonlar).
5. **Authentication → Sign In / Providers → Google**: istemci kimliği ve gizli anahtar. Google Cloud'daki
   OAuth istemcisinde *Authorized redirect URI* **yeni** adres olmalı:
   `https://skjibnltlwskndjfxqij.supabase.co/auth/v1/callback`.
6. **Authentication → Attack Protection**: Turnstile anahtarları hazır olunca CAPTCHA; istersen sızdırılmış
   şifre koruması.
7. Kayıt olduktan sonra **SQL Editor**'de kendini yönetici yap:
   `insert into private.admins (user_id) select id from auth.users where email = 'SENİN-E-POSTAN';`
8. Eski Mumbai projesi `projects list`'te görünmüyor; hâlâ duruyorsa içindeki deneme verileri için silmeyi düşün.

---

# 7 Kasım — Kararların uygulanması

## İş A — Anonim sohbetlerde "sohbeti sil" ✅

Migration 13 (`anon_chat_deletion`) uzağa uygulandı (dry-run → push).

- Anonim sohbet ekranında da çöp kutusu var; normal sohbetle **aynı** çalışıyor: yalnızca senin görünümünden
  siler, silen kişi eski mesajları API'den de göremez, karşı taraf görmeye devam eder, yeni mesaj gelirse
  sohbet yalnızca yeni mesajlarla geri gelir. "Tüm sohbetleri sil" artık anonim sohbetleri de kapsıyor.
- Silme karşı tarafa hiçbir şey göstermez ve hiçbir yanıta kimlik eklemez (kural 10, testli).
- Kimlik açılırsa ("Kimliğini aç") silinmiş mesajlar normal sohbette de geri gelmez.
- 90 gün kuralı anonim sohbetlere de uygulanıyor: iki taraf da sildiyse ve süre dolduysa kalıcı silinir;
  açık şikâyet varsa beklenir.
- Testler: 7 yeni test (migration'sız çalıştırıldığında kırıldıkları doğrulandı). `npm test` → 128/128.

### Kararlar
- Alıcı, **bekleyen** anonim isteği silemez; o bir sohbet değil, kabul/ret ile yanıtlanıyor (normal
  isteklerde de silme yok). Anonim taraf ise kendisine "bekliyor" görünen sohbeti silebilir; reddedilmiş
  sohbette de aynı yanıtı alır, böylece silme reddi ele vermez.

## İş B — Reddedilen istekler ✅

Migration 14 (`declined_requests`) uzağa uygulandı (dry-run → push).

- **Kalıcı:** reddedilen kişi aynı kişiye bir daha istek gönderemez (bir yıl sonra bile, testli). Reddi
  öğrenmez; ona isteği hep "gönderildi / bekliyor" görünür. Anonim isteklerde de kalıcı (kişi başına tek
  anonim sohbet zaten vardı).
- **Reddeden kendisi yazabilir:** reddettiğin kişinin profilinde "Mesaj gönder" açık (onun mesaj ayarı ne
  olursa olsun, çünkü sana o yazmıştı). Yazınca ret geri alınıp istek kabul edilmiş olur: onun ilk mesajı
  ve seninki aynı sohbette. Bu, günlük "20 yeni kişi" sınırına sayılmaz.
- **Ayarlar > Reddedilen istekler:** reddettiğin istekler (normal ve anonim) listeleniyor; "Reddi geri al"
  → istek yeniden İstekler'e düşer ve rozet sayısına eklenir. Normal isteklerde "Profili gör" bağlantısı var;
  anonim isteklerde yalnızca takma ad (kural 10, testli).
- İstek reddedildiğinde çıkan mesaj artık geri alma yerini de söylüyor.
- Testler: 6 yeni test. `npm test` → 134/134.

### Kararlar
- Engellediğin kişinin reddedilmiş isteği listede görünmez ve geri alınamaz (önce engeli kaldırman gerekir).
- Aranızda zaten bir sohbet varsa (ör. sonradan anonim sohbette kimlik açıldıysa) eski ret listede görünmez.
- Anonim listede süzgeçler mevcut anonim sohbet listesiyle aynı; yeni bir "kim kayboldu" yan kanalı açılmadı.
- Reddedilen isteklerin metni kalıcılık için saklanıyor (hesap silinirse 90 gün kuralıyla birlikte siliniyor).

## İş C — Yaş doğrulama belgesi ✅ (şifreleme anahtarını senin girmen gerekiyor)

Migration 15 (`age_verification`) uzağa uygulandı (dry-run → push); `age-documents` Edge Function'ı yayında.

**Kullanıcı tarafı:** "Yaşını doğrulaman gerekiyor" ekranında belge yükleme formu var. Durumlar: inceleniyor /
reddedildi (gerekçesiyle, yeniden yükleyebilir) / süresi doldu (yeniden yükler). İtiraz formu yedek olarak duruyor.

**Yönetim paneli → "Yaş doğrulama":** bekleyen belgeler; profildeki doğum tarihi ve yaş yanında. "Belgeyi göster"
→ belge yalnızca istenince açılır. Onayla → hesap yeniden açılır. Reddet → gerekçe kullanıcıya gösterilir.

**Güvenlik (CLAUDE.md kural 15 + kararların):**
- **Şifreli:** dosya AES-256-GCM ile şifrelenip yazılıyor. Anahtar veritabanında değil, yalnızca fonksiyonun
  ortamında (`AGE_DOC_KEY`). Dosya başka bir kaydın adıyla çözülemiyor. Fotoğraftaki GPS/üst veriler önce siliniyor.
- **Ayrı, gizli bucket:** `age-documents`. Hiçbir erişim kuralı yok, yani yönetici dahil kimse depolamadan
  doğrudan okuyamıyor. Tek yol fonksiyon. Kayıtlar API'ye kapalı tabloda; kullanıcı yalnızca kendi durumunu görüyor.
- **Kısa ömürlü bağlantı + kayıt:** her "Belgeyi göster" işlem kaydına yazılıyor (kim, hangi belge, ne zaman) ve
  60 saniye geçerli bir bağlantı üretiyor. Bağlantının kendisi saklanmıyor, yalnızca özeti. Önbelleğe alınmıyor.
- **30 gün:** belge yüklendikten 30 gün sonra (incelenmiş olsun olmasın) veritabanı onu hemen görüntülenemez
  yapıyor. Saatlik görev de dosyayı Storage API ile fiziksel olarak siliyor; Supabase dosyaların veritabanından
  doğrudan silinmesine izin vermiyor. Ek güvenlik ağı: bucket'ta 30 günden eski her dosya, kaydı olmasa bile siliniyor.
- Aynı anda tek bekleyen belge, 24 saatte en çok 3 yükleme, yalnızca JPEG/PNG/WebP, en çok 5 MB.
- Canlıda denendi: oturumsuz yükleme 401; sahte/boş görüntüleme bağlantısı 404; sahte silme görevi 403; anonim
  API çağrıları reddediliyor; bucket gizli ve kuralsız. Silme görevi gerçek belirteçle bir kez tetiklendi → 200
  (silinecek belge yoktu).
- Testler: 10 veritabanı + 10 fonksiyon testi. `npm test` → 154/154.

### Kararlar
- **30 gün yüklemeden itibaren sayılıyor.** Bu hem senin "30 gün sonra silinsin" kararını hem CLAUDE.md'deki
  "inceleme bittikten sonra en geç 30 gün" kuralını karşılıyor. 30 gün içinde incelenmeyen belge "süresi doldu"
  olur ve kullanıcı yeniden yükler.
- Yalnızca fotoğraf kabul ediliyor, PDF yok. PDF'lerdeki gizli verileri güvenle temizlemek zor.
- Ret hesabı kapatmıyor; kullanıcı yeni belge yükleyebilir. Belge 18 yaş altını gösteriyorsa hesap
  "Kullanıcılar" ekranından kalıcı kapatılmalı (panelde not olarak yazıyor).
- Saatlik görevin fonksiyonu çağırması için gereken adres migration'a yazılmadı (proje kodu repoda olmasın diye).
  Fonksiyon adresini ilk belge yüklendiğinde kendisi kaydediyor; ondan önce silinecek dosya da olmuyor. Görev
  belirteci migration dosyasında değil, uygulama anında veritabanında rastgele üretildi.

### ⚠️ Senden gereken: şifreleme anahtarı
Anahtarı Supabase'e kendim yazmak istedim, ama otomatik izin denetimi bu işlemi engelledi. Anahtar girilene
kadar belge yükleme **güvenli biçimde kapalı**: kullanıcı "Belge yüklenemedi" görür, şifresiz hiçbir dosya yazılmaz.
1. Terminalde: `openssl rand -base64 32` → çıkan değeri kopyala (hiçbir dosyaya kaydetme).
2. Supabase paneli → **Edge Functions → Secrets** → *Add new secret*: ad `AGE_DOC_KEY`, değer: kopyaladığın.
   (Ya da terminalde: `npx supabase secrets set AGE_DOC_KEY=<değer>`.)
3. Anahtarı değiştirirsen o ana kadar yüklenmiş belgeler açılamaz; belgeler en çok 30 gün yaşadığı için bu
   kalıcı bir kayıp yaratmaz.
