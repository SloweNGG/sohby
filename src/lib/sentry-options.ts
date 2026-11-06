/**
 * Ortak Sentry ayarları. DSN yoksa Sentry hiç başlatılmaz.
 * Gizlilik: kişisel veri gönderilmez (sendDefaultPii: false); istek gövdesi,
 * çerezler, başlıklar ve kullanıcı bilgisi olaydan silinir (mesaj içerikleri
 * dahil hiçbir kullanıcı verisi Sentry'ye gitmez). Oturum kaydı (replay) kapalı.
 */
type SentryEvent = {
  request?: { data?: unknown; cookies?: unknown; headers?: unknown; query_string?: unknown };
  user?: unknown;
  extra?: unknown;
  breadcrumbs?: unknown;
};

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

export function scrubEvent<T extends SentryEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  return event;
}

export const sentryOptions = {
  dsn: SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  beforeSend: scrubEvent,
};
