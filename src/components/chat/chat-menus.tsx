"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCheck, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { hideAllConversationsAction, hideConversationAction, markAllReadAction } from "@/lib/chat/actions";
import { hideAnonConversationAction } from "@/lib/anon/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { useBadges } from "@/components/app/badges";
import { useChats } from "./chats-shell";

const dialogClass =
  "m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-6 text-moon backdrop:bg-black/60";

/**
 * Sohbet başlığındaki çöp kutusu (tasarim/08): yalnızca kendi görünümünden siler.
 * `anon` ile anonim sohbette de aynı şekilde çalışır.
 */
export function DeleteConversationButton({ conversationId, anon = false }: { conversationId: string; anon?: boolean }) {
  const t = useTranslations("chat");
  const router = useRouter();
  const { refresh } = useChats();
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border border-edge hover:bg-surface"
        aria-label={t("delete")}
      >
        <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <dialog ref={ref} aria-label={t("deleteTitle")} className={dialogClass}>
        <h2 className="text-xl">{t("deleteTitle")}</h2>
        <p className="mt-2 leading-relaxed text-muted">{t("deleteBody")}</p>
        {error && (
          <div className="mt-4">
            <FormAlert>{t("deleteError")}</FormAlert>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            pending={pending}
            onClick={() =>
              startTransition(async () => {
                const r = anon ? await hideAnonConversationAction(conversationId) : await hideConversationAction(conversationId);
                if (!r.ok) return setError(true);
                ref.current?.close();
                refresh();
                router.replace("/chats");
              })
            }
          >
            {t("confirmDelete")}
          </Button>
        </div>
      </dialog>
    </>
  );
}

/** Sohbet listesinin "⋯" menüsü: tümünü okundu işaretle / tüm sohbetleri sil. */
export function ChatsMenu() {
  const t = useTranslations("chats");
  const router = useRouter();
  const { refresh } = useChats();
  const badges = useBadges();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const close = () => {
    if (menuRef.current) menuRef.current.open = false;
  };
  return (
    <>
      <details ref={menuRef} className="relative">
        <summary
          className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-2xl border border-edge hover:bg-surface [&::-webkit-details-marker]:hidden"
          aria-label={t("menu")}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 top-12 z-40 w-60 rounded-2xl border border-edge bg-surface p-1.5 shadow-xl">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line"
            onClick={() =>
              startTransition(async () => {
                close();
                await markAllReadAction();
                refresh();
                badges.refresh();
              })
            }
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {t("markAllRead")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-coral-text hover:bg-line"
            onClick={() => {
              close();
              dialogRef.current?.showModal();
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("deleteAll")}
          </button>
        </div>
      </details>
      <dialog ref={dialogRef} aria-label={t("deleteAllTitle")} className={dialogClass}>
        <h2 className="text-xl">{t("deleteAllTitle")}</h2>
        <p className="mt-2 leading-relaxed text-muted">{t("deleteAllBody")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            pending={pending}
            onClick={() =>
              startTransition(async () => {
                await hideAllConversationsAction();
                dialogRef.current?.close();
                refresh();
                badges.refresh();
                router.replace("/chats");
              })
            }
          >
            {t("confirmDelete")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
