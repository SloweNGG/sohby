"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, UserCheck, UserMinus, UserPlus, UserX, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  cancelFriendRequestAction,
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
  type FriendErrorCode,
} from "@/lib/friends/actions";
import type { FriendActionRunner } from "@/lib/friends/types";
import type { FriendState } from "@/lib/types";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Props = {
  targetId: string;
  name: string;
  state: Exclude<FriendState, "self">;
  incomingRequestId: string | null;
  /** desktop: yazılı düğme; mobile: yuvarlak simge düğmesi (tasarim/15). */
  variant?: "desktop" | "mobile";
};

const ICONS = { none: UserPlus, outgoing: Clock, incoming: UserPlus, friends: UserCheck } as const;

/**
 * Profildeki arkadaşlık düğmesi (tasarim/07 "Arkadaş ekle").
 * Durumlar: Arkadaş ekle → İstek gönderildi (geri çekilebilir);
 * gelen istek → Kabul et / Reddet; Arkadaşsınız → Arkadaşlıktan çıkar.
 */
export function FriendButton({ targetId, name, state: initialState, incomingRequestId, variant = "desktop" }: Props) {
  const t = useTranslations("friends");
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<FriendErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const run = (action: FriendActionRunner) => {
    setError(null);
    if (menuRef.current) menuRef.current.open = false;
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setState(result.state === "self" ? "none" : result.state);
      dialogRef.current?.close();
      router.refresh();
    });
  };

  const send = () => run(() => sendFriendRequestAction(targetId));
  const cancel = () => run(() => cancelFriendRequestAction(targetId));
  const remove = () => run(() => removeFriendAction(targetId));
  const respond = (accept: boolean) =>
    incomingRequestId ? run(() => respondFriendRequestAction(incomingRequestId, accept)) : undefined;

  const label = {
    none: t("add"),
    outgoing: t("requestSent"),
    incoming: t("acceptRequest"),
    friends: t("friends"),
  }[state];
  const Icon = ICONS[state];
  const mobile = variant === "mobile";
  const triggerClass = mobile
    ? cn(
        "grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border",
        state === "friends" || state === "incoming" ? "border-lilac text-lilac" : "border-edge",
        pending && "opacity-55",
      )
    : cn(buttonClasses({ variant: "outline", size: "lg" }), state === "friends" && "border-lilac", pending && "opacity-55");

  const menuItem = "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line";

  let control: React.ReactNode;
  if (state === "none") {
    control = (
      <button type="button" onClick={send} disabled={pending} className={triggerClass} aria-label={mobile ? label : undefined}>
        <Icon className="h-5 w-5" aria-hidden="true" />
        {!mobile && label}
      </button>
    );
  } else if (state === "incoming" && !mobile) {
    control = (
      <>
        <button type="button" onClick={() => respond(true)} disabled={pending} className={cn(triggerClass, "border-lilac")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          {label}
        </button>
        <button type="button" onClick={() => respond(false)} disabled={pending} className="text-[15px] text-muted hover:text-moon">
          {t("decline")}
        </button>
      </>
    );
  } else {
    control = (
      <details ref={menuRef} className="relative">
        <summary
          className={cn(triggerClass, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}
          aria-label={mobile ? label : undefined}
          aria-disabled={pending || undefined}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {!mobile && label}
        </summary>
        <div
          className={cn(
            "absolute z-40 mt-2 w-56 rounded-2xl border border-edge bg-surface p-1.5 shadow-xl",
            mobile ? "right-0" : "left-0",
          )}
        >
          {mobile && <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted">{label}</p>}
          {state === "outgoing" && (
            <button type="button" onClick={cancel} className={menuItem}>
              <UserX className="h-4 w-4" aria-hidden="true" />
              {t("cancelRequest")}
            </button>
          )}
          {state === "incoming" && (
            <>
              <button type="button" onClick={() => respond(true)} className={menuItem}>
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                {t("accept")}
              </button>
              <button type="button" onClick={() => respond(false)} className={menuItem}>
                <UserX className="h-4 w-4" aria-hidden="true" />
                {t("decline")}
              </button>
            </>
          )}
          {state === "friends" && (
            <button
              type="button"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                dialogRef.current?.showModal();
              }}
              className={cn(menuItem, "text-coral-text")}
            >
              <UserMinus className="h-4 w-4" aria-hidden="true" />
              {t("remove")}
            </button>
          )}
        </div>
      </details>
    );
  }

  return (
    <>
      {control}
      {error && (
        <p role="alert" className="basis-full text-sm text-coral-text">
          {t(`errors.${error}`)}
        </p>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-0 text-moon backdrop:bg-black/60"
      >
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl leading-snug">
              {t("removeTitle", { name })}
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="-m-2 rounded-full p-2 text-muted hover:text-moon"
              aria-label={t("cancel")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="leading-relaxed text-muted">{t("removeBody", { name })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={remove} pending={pending}>
              {t("removeConfirm")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
