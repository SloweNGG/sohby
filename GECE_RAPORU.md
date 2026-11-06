# Gece Raporu — 7 Kasım 2026

> Bu dosya her adımdan sonra güncellendi. En güncel durum en üstteki özet tablodadır.

## Özet

| # | Adım | Durum |
| --- | --- | --- |
| 1 | Next.js + Cloudflare Workers + Tailwind + next-intl + tema | ✅ Bitti |
| 2 | Veritabanı migration'ları + RLS | ✅ Bitti (35 test geçiyor) |
| 3 | Kayıt / giriş / şifre sıfırlama | ⏳ |
| 4 | Başlangıç soruları akışı | ⏳ |
| 5 | Keşfet + filtreler + kişi profili | ⏳ |
| 6 | Birebir mesajlaşma (Realtime) | ⏳ |
| 7 | Mesaj istekleri | ⏳ |
| 8 | Engelle / şikâyet et | ⏳ |
| 9 | Tanıtım sayfası | ⏳ |

## ⚠️ Sabah ilk bakman gerekenler

1. **CLAUDE.md bulunamadı.** Proje klasöründe `CLAUDE.md` yok, `claudecode.md` ise boş (0 bayt).
   "CLAUDE.md'deki güvenlik kurallarına birebir uy" talimatını bu yüzden uygulayamadım; onun yerine
   aşağıda "Güvenlik varsayımları" bölümündeki **en sıkı** kuralları uyguladım. Dosyayı eklersen
   migration'ı onunla karşılaştırıp farkları kapatmam gerekir.
2. **Supabase adresi eksik.** Mesajda `NEXT_PUBLIC_SUPABASE_URL=[PROJE_ADRESİ]` yer tutucu olarak
   gelmiş. `.env.local` dosyasına aynen bu değeri yazdım; gerçek adresi (`https://xxxx.supabase.co`)
   girmen gerekiyor. Adres geçersizken uygulama çökmez, Supabase gerektiren sayfalar
   "yapılandırma eksik" mesajı gösterir.

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
