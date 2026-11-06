// Sunucu tarafı hata takibi (Sentry). DSN yoksa hiçbir şey yapılmaz.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, sentryOptions } from "@/lib/sentry-options";

export async function register() {
  if (!SENTRY_DSN) return;
  Sentry.init({ ...sentryOptions });
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (SENTRY_DSN) Sentry.captureRequestError(...args);
};
