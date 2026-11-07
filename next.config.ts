import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Not: `cacheComponents` bilinçli olarak kapalı. Uygulamanın neredeyse tamamı
// oturuma bağlı (dinamik) ve OpenNext Cloudflare adaptörü bu özelliği henüz
// resmi olarak belgelemiyor.
const nextConfig: NextConfig = {
  // Uçtan uca test sunucusu ayrı klasörde derlenir (NEXT_DIST_DIR=.next-e2e);
  // böylece geliştirme sunucusuyla aynı anda çalışabilir. Normalde .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  experimental: {
    // Profil fotoğrafı yükleme (en çok 5 MB) Server Action üzerinden geçer.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

// `next dev` sırasında Cloudflare bağlamını (env, bindings) erişilebilir kılar.
initOpenNextCloudflareForDev();
