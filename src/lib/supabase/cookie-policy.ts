/**
 * "Beni hatırla" işaretlenmediyse oturum çerezleri tarayıcı kapanınca silinen
 * oturum çerezlerine (maxAge/expires olmadan) dönüştürülür. Tercih, kendisi de
 * bir oturum çerezi olan SESSION_ONLY_COOKIE ile hatırlanır; böylece middleware
 * belirteci yenilediğinde de kalıcı çereze dönüşmez.
 */
export const SESSION_ONLY_COOKIE = "sohby_session_only";

type CookieOptionsLike = { maxAge?: number; expires?: Date | number | string } & Record<string, unknown>;

export function applyCookiePolicy<T extends CookieOptionsLike | undefined>(
  options: T,
  sessionOnly: boolean,
): T {
  if (!sessionOnly || !options) return options;
  // Silme işlemleri (maxAge 0) olduğu gibi kalmalı.
  if (options.maxAge === 0) return options;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxAge, expires, ...rest } = options;
  return rest as T;
}
