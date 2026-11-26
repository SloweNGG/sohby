"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Copy, Plus, SmilePlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { QUICK_REACTIONS, reactionChips, reactionsOf, type Reactable } from "@/lib/chat/reactions";
import { EmojiPicker } from "./emoji-picker";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * Dokunmatik ekranda basılı tutma (ve sağ tık / Android'in uzun basma
 * olayı). Basılı tutma tetiklendiyse ardından gelen tıklama yutulur; böylece
 * fotoğraf açılmaz, ses çalmaz.
 */
function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => clear, []);

  if (!enabled) return {};
  const fire = () => {
    fired.current = true;
    clear();
    try {
      navigator.vibrate?.(10);
    } catch {
      /* titreşim yoksa geç */
    }
    onLongPress();
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      if (e.pointerType === "mouse") return; // farede menü sağ tık ve düğmeyle açılır
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      if (!fired.current) fire();
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

/**
 * Bir mesaj satırı: baloncuk + tepki düğmesi + baloncuğun altındaki tepki
 * rozetleri. Menü; telefonda basılı tutunca, masaüstünde üzerine gelince
 * beliren düğmeyle ya da sağ tıkla açılır. Düğme ekran okuyucu ve klavye
 * için her zaman erişilebilir.
 */
export function MessageRow({
  message,
  mine,
  otherName,
  canOpen,
  onOpen,
  children,
}: {
  message: Reactable;
  mine: boolean;
  /** Karşı tarafın görünen adı (anonim sohbette takma ad). */
  otherName: string;
  /** Menü açılabilir mi? (Gönderilmekte olan mesajda kapalı.) */
  canOpen: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("chat.reactions");
  const press = useLongPress(onOpen, canOpen);
  const chips = reactionChips(message, mine);
  const { me, other } = reactionsOf(message, mine);
  const summary = [me ? t("byYou", { emoji: me }) : null, other ? t("byOther", { name: otherName, emoji: other }) : null]
    .filter(Boolean)
    .join(", ");

  const trigger = canOpen ? (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("open")}
      aria-haspopup="dialog"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-opacity hover:bg-surface hover:text-moon",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        // Dokunmatik ekranda görünmez (basılı tutma var) ama ekran okuyucu bulur.
        "[@media(hover:none)]:sr-only",
      )}
    >
      <SmilePlus className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  ) : null;

  return (
    <>
      <div className={cn("group flex items-center gap-1", mine ? "justify-end" : "justify-start")}>
        {mine && trigger}
        <div
          {...press}
          className="min-w-0 max-w-[85%] [-webkit-touch-callout:none] md:max-w-[65%] [@media(hover:none)]:select-none"
        >
          {children}
        </div>
        {!mine && trigger}
      </div>
      {chips.length > 0 && (
        <div className={cn("relative z-[1] -mt-2.5 flex px-3", mine ? "justify-end" : "justify-start")}>
          {canOpen ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={t("summary", { list: summary })}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-night-deep px-2 py-0.5 text-[15px] leading-6 hover:border-edge"
            >
              <Chips chips={chips} />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-night-deep px-2 py-0.5 text-[15px] leading-6">
              <span className="sr-only">{t("summary", { list: summary })}</span>
              <Chips chips={chips} hidden />
            </span>
          )}
        </div>
      )}
    </>
  );
}

function Chips({ chips, hidden = false }: { chips: ReturnType<typeof reactionChips>; hidden?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden={hidden || undefined}>
      {chips.map((c) => (
        <span key={c.emoji} className="inline-flex items-center">
          {c.emoji}
          {c.count > 1 && <span className="ml-0.5 text-xs font-semibold text-muted">{c.count}</span>}
        </span>
      ))}
    </span>
  );
}

export type ActionTarget = {
  id: string;
  /** Menünün başında gösterilen kısa önizleme. */
  preview: string;
  /** Bu mesaja benim bıraktığım tepki. */
  myReaction: string | null;
  /** Tepki bırakılabilir mi? (Engel, askı, kabul edilmemiş sohbet: hayır.) */
  canReact: boolean;
  /** Kopyalanacak metin (yalnızca yazılı mesajlar). */
  copyText?: string;
};

/**
 * Mesaj menüsü: telefonda alttan açılan sayfa, masaüstünde ortada küçük pencere.
 * Hızlı tepkiler + "daha fazla" (tüm emojiler) + kopyala. Seçili tepkiye tekrar
 * basmak tepkiyi kaldırır.
 */
export function MessageActionsDialog({
  target,
  onClose,
  onReact,
}: {
  target: ActionTarget | null;
  onClose: () => void;
  onReact: (id: string, emoji: string | null) => void;
}) {
  const t = useTranslations("chat.reactions");
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const [view, setView] = useState<"menu" | "picker">("menu");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      setView("menu");
      dialog.showModal();
    } else if (!target && dialog.open) {
      dialog.close();
    }
  }, [target]);

  const choose = (emoji: string) => {
    if (!target) return;
    onReact(target.id, emoji === target.myReaction ? null : emoji);
    onClose();
  };

  const copy = async () => {
    if (!target?.copyText) return;
    try {
      await navigator.clipboard.writeText(target.copyText);
    } catch {
      /* pano izni yoksa sessizce geç */
    }
    onClose();
  };

  // Hızlı listede olmayan bir tepki seçiliyse o da listede gösterilir.
  const quick: string[] =
    target?.myReaction && !(QUICK_REACTIONS as readonly string[]).includes(target.myReaction)
      ? [target.myReaction, ...QUICK_REACTIONS.slice(0, 5)]
      : [...QUICK_REACTIONS];

  return (
    <dialog
      ref={ref}
      aria-label={t("title")}
      onClose={onClose}
      // Dışarı (karartılmış alana) dokununca kapanır — yalnızca dokunuş orada
      // BAŞLADIYSA. Basılı tutmayla açılınca parmak kalkarken gelen tıklama
      // karartılmış alana düşer; o, menüyü hemen kapatmamalı.
      onPointerDown={(e) => {
        backdropPress.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropPress.current) onClose();
        backdropPress.current = false;
      }}
      className={cn(
        "border border-edge bg-surface p-4 text-moon backdrop:bg-black/60",
        // Telefon: alttan açılan sayfa
        "mb-0 mt-auto w-full max-w-none rounded-t-[28px] pb-[max(16px,env(safe-area-inset-bottom))]",
        // Masaüstü: ortada pencere
        "md:m-auto md:w-[calc(100%-2rem)] md:max-w-md md:rounded-[28px] md:pb-4",
      )}
    >
      {target && view === "picker" ? (
        <EmojiPicker onPick={choose} onBack={() => setView("menu")} />
      ) : target ? (
        <div>
          <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-edge md:hidden" aria-hidden="true" />
          <p className="line-clamp-2 break-words px-1 text-sm text-muted">{target.preview}</p>

          {target.canReact && (
            <div className="mt-3 flex items-center justify-between gap-1 rounded-full bg-night-deep p-1.5" role="group" aria-label={t("quick")}>
              {quick.map((emoji) => {
                const selected = emoji === target.myReaction;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => choose(emoji)}
                    aria-pressed={selected}
                    aria-label={selected ? t("remove", { emoji }) : t("react", { emoji })}
                    className={cn(
                      "grid h-11 w-11 place-items-center rounded-full text-[26px] leading-none transition-transform hover:scale-110 motion-reduce:hover:scale-100",
                      selected && "bg-line ring-2 ring-coral",
                    )}
                  >
                    {emoji}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setView("picker")}
                aria-label={t("more")}
                className="grid h-11 w-11 place-items-center rounded-full bg-line text-moon hover:bg-edge"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          )}

          {target.copyText && (
            <ul className="mt-3">
              <li>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] hover:bg-line"
                >
                  <Copy className="h-5 w-5 text-lilac" aria-hidden="true" />
                  {t("copy")}
                </button>
              </li>
            </ul>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
