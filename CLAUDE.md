# Sohby

Herkese açık (18+) bir sohbet ve tanışma uygulaması. Kullanıcılar profil oluşturur (semt, hobiler, ne aradığı), Keşfet'te birbirini bulur ve birebir mesajlaşır. Arkadaşlık, flört ve anonim sohbet desteklenir. Alan adı: sohbyapp.com. Arayüz dili Türkçe (varsayılan) ve İngilizce.

## Teknoloji

- Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- Çoklu dil: next-intl. Türkçe `/`, İngilizce `/en`. Arayüzde hiçbir metin koda gömülmez; hepsi `messages/tr.json` ve `messages/en.json` içinde durur.
- Supabase: Auth (e-posta + şifre, Google), Postgres, Realtime, Storage, Edge Functions
- Barındırma: Cloudflare Workers, OpenNext adaptörü (`@opennextjs/cloudflare`)
- Robot koruması: Cloudflare Turnstile (kayıt ve giriş formları)
- E-posta: Resend, Supabase'in SMTP ayarı üzerinden
- Hata takibi: Sentry
- Yönetim paneli ayrı bir uygulama: admin.sohbyapp.com, Cloudflare Access ile korunur

## Güvenlik kuralları (asla esnetme)

1. Her tabloda Row Level Security açık olur. İstemciden gelen hiçbir veriye güvenme; izinler veritabanında ya da Edge Function'da kontrol edilir.
2. `service_role` (secret) anahtarı yalnızca Edge Function'larda kullanılır; asla tarayıcıya gitmez ve asla repoya girmez. Gizli anahtarlar `.env.local` içindedir ve `.gitignore`'dadır.
3. Mesajları yalnızca sohbetin iki katılımcısı okuyabilir.
4. Fotoğraf ve sesli mesajlar gizli bir Storage bucket'ında tutulur; yalnızca katılımcılara kısa ömürlü imzalı bağlantılarla verilir.
5. Alıcının medya izni (fotoğraf ve ses: herkes, yalnızca arkadaşlar, kimse) sunucuda kontrol edilir; izin yoksa yükleme reddedilir.
6. Engellenen kullanıcı mesaj gönderemez ve engelleyeni Keşfet'te ya da haritada göremez.
7. Mesaj isteği: alıcı "önce istek" seçtiyse kabul edilene kadar yalnızca tek mesaj gönderilebilir, medya gönderilemez.
8. Hız sınırları: günde en fazla 20 yeni kişiye ilk mesaj, anonim sohbette daha düşük sınır.
9. Kayıtta doğum tarihi istenir; 18 yaşından küçükler kayıt olamaz. E-posta doğrulanmadan mesaj gönderilemez.
10. Anonim sohbette gönderenin gerçek kimliği alıcıya hiçbir API yanıtında sızmaz; engelleme ve şikâyet gerçek hesaba işler.
11. Flörtte ilgilenilen cinsiyet bilgisi özel nitelikli veridir: ayrı tabloda tutulur, hiçbir kullanıcı okuyamaz, yalnızca eşleştirme fonksiyonu kullanır, rıza geri çekilince silinir.
12. Konum yalnızca semt düzeyindedir; tam konum ya da GPS hiçbir zaman alınmaz.
13. Sohbet silme yalnızca kullanıcının kendi görünümünden siler; mesajlar şikâyet incelemesi için belirli bir süre saklanır.
14. Yöneticinin yaptığı her işlem ve her sohbet görüntüleme silinemez bir işlem kaydına yazılır.
15. Yaş doğrulama belgeleri şifreli ve ayrı bir bucket'ta tutulur, inceleme bittikten sonra en geç 30 gün içinde silinir.

## Tasarım sistemi (Gece teması)

Yazı tipi: Sora (Google Fonts), tek aile. Başlıklar 800, gövde 400, vurgu 600.

| Ad | Renk | Kullanım |
|---|---|---|
| gece | #1E1033 | Sayfa zemini |
| gece-koyu | #160B27 | Yan menü, paneller |
| yuzey | #2B1A4A | Kartlar, giriş alanları |
| cizgi | #3D2A63 | Ayırıcılar |
| cerceve | #4A3675 | İkincil düğme ve alan kenarları |
| mercan | #FF6B57 | Ana düğmeler, seçili öğeler, rozetler |
| mercan-yazi | #FF8A7A | Koyu zemin üzerinde mercan tonlu yazı, tehlike |
| lila | #CDB8FF | İkincil vurgu, bağlantılar, avatarlar |
| ay-isigi | #F6F1FF | Ana yazı |
| soluk-yazi | #B9AED6 | İkincil yazı |
| cevrimici | #8FE3B0 | Yalnızca çevrimiçi göstergesi |

- Mercan yalnızca düğmelerde, seçili öğelerde ve küçük vurgularda kullanılır; asla büyük bir yüzeyin zemini olmaz. Mercan üzerindeki yazı her zaman #1E1033'tür.
- Yeşil yalnızca çevrimiçi durumu anlamına gelir; başka hiçbir yerde kullanılmaz.
- Köşeler: düğmeler tam yuvarlak (999px), kartlar 20-28px, giriş alanları 16px.
- Masaüstünde solda dikey menü (Keşfet, Harita, Sohbetler, Bildirimler, Ayarlar, Profil). Telefonda altta beş sekmeli menü.
- Gelen fotoğraflar varsayılan olarak bulanık gelir, "Fotoğrafı göster" ile açılır.
- Erişilebilirlik: gerçek `<button>`, `<a>`, `<label>` kullan; simge düğmelerine `aria-label` ekle; yazı kontrastı en az 4.5:1.

## Kapsam

**1. aşama (MVP):** tanıtım sayfası, kayıt, giriş, şifre sıfırlama, başlangıç soruları (flört seçilirse ilgi ve açık rıza adımı dahil), Keşfet, kişi profili, birebir yazılı mesajlaşma (Realtime), mesaj istekleri, flört, anonim sohbet ve kimlik açma, engelle, şikâyet et, sohbet silme ve toplu silme, profil düzenleme, gizlilik ayarları, TR/EN dil desteği, yönetim panelinde şikâyetler, fotoğraf onayı (otomatik onay anahtarlı) ve kullanıcılar, kullanıcı tarafında yaş doğrulama, askıya alma ve kapatma ekranları.

**2. aşama:** fotoğraf ve sesli mesaj, arkadaşlık sistemi, bildirim paneli ve Web Push, harita, yönetim panelinde genel bakış ve KVKK talepleri.

## Çalışma şekli

- Küçük adımlarla ilerle. Her adımdan sonra ne yaptığını kısaca özetle ve kullanıcının test etmesi için ne yapması gerektiğini söyle.
- Veritabanı değişiklikleri `supabase/migrations` altında migration dosyası olarak yazılır; elle yapılan değişiklik yok.
- Her çalışan adımdan sonra anlamlı bir mesajla git commit at.
- Kullanıcı Türkçe konuşur; açıklamaları Türkçe ve teknik olmayan bir dille yap.
- Emin olmadığın bir konuda tahmin yürütme; sor.
