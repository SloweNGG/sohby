# Sohby

Yakındaki, aynı hobileri paylaşan insanlarla tanışma ve birebir mesajlaşma uygulaması.

- **Next.js 16** (App Router, TypeScript) — Cloudflare Workers'a **OpenNext** ile paketlenir
- **Tailwind CSS v4** — tasarım belirteçleri `src/app/globals.css` içinde
- **next-intl** — TR (varsayılan, öneksiz) / EN (`/en/...`)
- **Supabase** — Auth, Postgres (RLS), Realtime

## Kurulum

```bash
npm install
cp .env.example .env.local   # Supabase adresi ve publishable anahtarı
npm run dev                  # http://localhost:3000
```

## Komutlar

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Next.js üretim derlemesi |
| `npm run cf:build` | Cloudflare Workers paketi (`.open-next/`) |
| `npm run preview` | Workers paketini yerelde wrangler ile çalıştırır |
| `npm run typecheck` | TypeScript denetimi |
| `npm test` | Tüm testler (veritabanı/RLS + birim) |
| `npm run test:db` | Yalnızca migration + RLS testleri (PGlite, Docker gerektirmez) |

## Klasörler

- `tasarim/` — ekran tasarımları (referans PNG'ler)
- `supabase/migrations/` — veritabanı şeması ve erişim kuralları
- `supabase/tests/` — RLS / iş kuralı / CLAUDE.md kuralı testleri
- `supabase/functions/` — Edge Function'lar (fotoğraf yükleme, yaş belgesi, 18 yaş altı silme)
- `admin/` — yönetim paneli (ayrı Next.js uygulaması, admin.sohbyapp.com)
- `messages/` — çeviri dosyaları
- `src/app/[locale]/` — sayfalar
- `scripts/screenshot.mjs` — yüklü Chrome ile sayfa ekran görüntüsü (tasarımla karşılaştırma için)
- `scripts/merge-messages.mjs` — çeviri dosyalarına toplu anahtar ekleme

Gece çalışmasının ayrıntılı raporu ve açık sorular: `GECE_RAPORU.md`.

## Uçtan uca testler

`npm run dev` açıkken `npm run test:e2e` → gerçek Supabase projesine karşı Playwright (bilgisayardaki Chrome). Sonuçlar ve ekran görüntüleri `e2e-sonuclar/` (git dışı). Test hesaplarını silmek: `e2e/temizle.sql` (Supabase SQL Editor).
