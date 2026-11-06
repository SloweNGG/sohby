// Tarayıcı tarafı hata takibi (Sentry). DSN yoksa hiçbir şey yapılmaz.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, sentryOptions } from "@/lib/sentry-options";

if (SENTRY_DSN) {
  Sentry.init({ ...sentryOptions });
}

export const onRouterTransitionStart = SENTRY_DSN ? Sentry.captureRouterTransitionStart : undefined;
