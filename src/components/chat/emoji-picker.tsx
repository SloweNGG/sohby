"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  foldSearch,
  matchesSearch,
  withSkinTone,
  type EmojiData,
  type EmojiItem,
  type SkinTone,
} from "@/lib/chat/reactions";

/** Kategori sekmelerinin simgesi (veri dosyasındaki grup anahtarına göre). */
const GROUP_ICONS = {
  "smileys-emotion": "😀",
  "people-body": "🧑",
  "animals-nature": "🐻",
  "food-drink": "🍔",
  "travel-places": "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🏳️",
} as const;
type GroupKey = keyof typeof GROUP_ICONS;
const isGroupKey = (key: string): key is GroupKey => key in GROUP_ICONS;
const TONES = [
  [0, "✋"],
  [1, "✋🏻"],
  [2, "✋🏼"],
  [3, "✋🏽"],
  [4, "✋🏾"],
  [5, "✋🏿"],
] as const;
const TONE_KEY = "sohby.skinTone";

type Indexed = { key: GroupKey; items: Array<{ item: EmojiItem; search: string }> };

// Veri bir kez indirilir (sayfa boyunca bellekte kalır).
const cache = new Map<string, Promise<Indexed[]>>();
function loadEmoji(locale: string): Promise<Indexed[]> {
  const lang = locale === "en" ? "en" : "tr";
  let p = cache.get(lang);
  if (!p) {
    p = fetch(`/emoji/${lang}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<EmojiData>;
      })
      .then((data) =>
        data.groups.flatMap((g) =>
          isGroupKey(g.key)
            ? [{ key: g.key, items: g.items.map((item) => ({ item, search: foldSearch(`${item[1]} ${item[2]}`) })) }]
            : [],
        ),
      );
    p.catch(() => cache.delete(lang));
    cache.set(lang, p);
  }
  return p;
}

function readTone(): SkinTone {
  try {
    const v = Number(window.localStorage.getItem(TONE_KEY));
    return (v >= 0 && v <= 5 ? v : 0) as SkinTone;
  } catch {
    return 0;
  }
}

/**
 * Tüm emojiler: arama (Türkçe, aksansız da bulur), kategori sekmeleri, ten
 * rengi. Veri (public/emoji/<dil>.json) yalnızca seçici açılınca indirilir.
 */
export function EmojiPicker({ onPick, onBack }: { onPick: (emoji: string) => void; onBack: () => void }) {
  const t = useTranslations("chat.reactions.picker");
  const locale = useLocale();
  const [groups, setGroups] = useState<Indexed[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  // Seçici yalnızca tarayıcıda, kullanıcı açınca çizilir; tercih hemen okunabilir.
  const [tone, setTone] = useState<SkinTone>(readTone);
  const [active, setActive] = useState<GroupKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadEmoji(locale)
      .then((g) => {
        if (!alive) return;
        setGroups(g);
        setActive(g[0]?.key ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [locale, attempt]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!groups || !deferredQuery.trim()) return null;
    const out: EmojiItem[] = [];
    for (const g of groups) for (const e of g.items) if (matchesSearch(e.search, deferredQuery)) out.push(e.item);
    return out;
  }, [groups, deferredQuery]);

  function chooseTone(next: SkinTone) {
    setTone(next);
    try {
      window.localStorage.setItem(TONE_KEY, String(next));
    } catch {
      /* tercih yalnızca bu oturumda kalır */
    }
  }

  function jumpTo(key: GroupKey) {
    setQuery("");
    setActive(key);
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-group="${key}"]`);
      if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop - scrollRef.current.offsetTop;
    });
  }

  // Kaydırınca etkin sekme güncellenir.
  function onScroll() {
    const box = scrollRef.current;
    if (!box || results) return;
    const sections = box.querySelectorAll<HTMLElement>("[data-group]");
    let current: GroupKey | null = active;
    for (const s of sections) {
      const key = s.dataset.group ?? "";
      if (isGroupKey(key) && s.offsetTop - box.offsetTop <= box.scrollTop + 8) current = key;
    }
    if (current !== active) setActive(current);
  }

  const grid = (items: EmojiItem[]) => (
    <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-9">
      {items.map((item) => {
        const emoji = withSkinTone(item, tone);
        return (
          <button
            key={item[0]}
            type="button"
            onClick={() => onPick(emoji)}
            title={item[1]}
            aria-label={item[1]}
            className="grid aspect-square place-items-center rounded-xl text-[26px] leading-none hover:bg-line focus-visible:bg-line"
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-[min(440px,60dvh)] flex-col">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-moon hover:bg-line"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <label className="relative flex-1">
          <span className="sr-only">{t("search")}</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            enterKeyHint="search"
            autoComplete="off"
            className="h-10 w-full rounded-2xl border border-edge bg-night-deep pl-10 pr-3 text-[15px] outline-none placeholder:text-muted focus:border-lilac/80"
          />
        </label>
      </div>

      {/* Ten rengi */}
      <fieldset className="mt-3 flex items-center gap-1">
        <legend className="sr-only">{t("skinTone")}</legend>
        {TONES.map(([i, sample]) => (
          <label key={i} className="cursor-pointer">
            <input
              type="radio"
              name="emoji-skin-tone"
              className="peer sr-only"
              checked={tone === i}
              onChange={() => chooseTone(i)}
            />
            <span className="sr-only">{t(`tones.${i}`)}</span>
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full text-lg peer-checked:ring-2 peer-checked:ring-coral peer-focus-visible:outline-2 peer-focus-visible:outline-lilac"
            >
              {sample}
            </span>
          </label>
        ))}
      </fieldset>

      {/* Kategoriler */}
      {groups && (
        <nav className="scrollbar-none mt-2 flex gap-0.5 overflow-x-auto border-b border-line pb-1" aria-label={t("categories")}>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => jumpTo(g.key)}
              aria-label={t(`groups.${g.key}`)}
              aria-current={!results && active === g.key ? "true" : undefined}
              title={t(`groups.${g.key}`)}
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg hover:bg-line",
                !results && active === g.key && "bg-line ring-1 ring-coral",
              )}
            >
              {GROUP_ICONS[g.key]}
            </button>
          ))}
        </nav>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="relative mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        {failed ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted">
            <p>
              {t("loadError")}{" "}
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                  setAttempt((n) => n + 1);
                }} className="font-semibold text-lilac underline underline-offset-2">
                {t("retry")}
              </button>
            </p>
          </div>
        ) : !groups ? (
          <p className="grid h-full place-items-center text-sm text-muted" role="status">
            {t("loading")}
          </p>
        ) : results ? (
          results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted" role="status">
              {t("noResults")}
            </p>
          ) : (
            <>
              <p className="sr-only" role="status">
                {t("resultCount", { count: results.length })}
              </p>
              {grid(results.slice(0, 240))}
            </>
          )
        ) : (
          groups.map((g) => (
            <section
              key={g.key}
              data-group={g.key}
              aria-label={t(`groups.${g.key}`)}
              // Görünmeyen kategoriler çizilmez (≈1900 düğme); yer tutucu yükseklik kaydırmayı korur.
              className="pb-3 [contain-intrinsic-size:auto_480px] [content-visibility:auto]"
            >
              <h3 className="sticky top-0 z-10 bg-surface py-1.5 text-xs font-semibold text-muted">{t(`groups.${g.key}`)}</h3>
              {grid(g.items.map((e) => e.item))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
