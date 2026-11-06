"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Sohbet listesi zaman etiketi (tasarim/13): bugün → "14:32", dün → "Dün",
 * son 6 gün → "Pzt", daha eski → "07.11.26". `relative` ile 24 saatten
 * yeni olanlar "10 dk" / "1 sa" biçiminde (tasarim/09).
 * Saat dilimi next-intl yapılandırmasından gelir (sunucu/istemci aynı).
 */
export function useListTime(relative = false) {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const t = useTranslations("chats");

  return (iso: string) => {
    const date = new Date(iso);
    const diff = now.getTime() - date.getTime();
    const dayKey = (d: Date) => format.dateTime(d, { year: "numeric", month: "2-digit", day: "2-digit" });

    if (relative && diff < DAY) {
      const minutes = Math.max(1, Math.round(diff / 60_000));
      return minutes < 60 ? t("minutesShort", { count: minutes }) : t("hoursShort", { count: Math.round(minutes / 60) });
    }
    if (dayKey(date) === dayKey(now)) return format.dateTime(date, { hour: "2-digit", minute: "2-digit" });
    if (dayKey(date) === dayKey(new Date(now.getTime() - DAY))) return t("yesterday");
    if (diff < 6 * DAY) return format.dateTime(date, { weekday: "short" });
    return format.dateTime(date, { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
}

/** Sohbet içi gün ayracı: "Bugün", "Dün" ya da tarih. */
export function useDayLabel() {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const t = useTranslations("chats");
  return (iso: string) => {
    const date = new Date(iso);
    const key = (d: Date) => format.dateTime(d, { year: "numeric", month: "2-digit", day: "2-digit" });
    if (key(date) === key(now)) return t("today");
    if (key(date) === key(new Date(now.getTime() - DAY))) return t("yesterday");
    return format.dateTime(date, { day: "numeric", month: "long", year: "numeric" });
  };
}

export function useDayKey() {
  const format = useFormatter();
  return (iso: string) => format.dateTime(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function useClock() {
  const format = useFormatter();
  return (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
}
