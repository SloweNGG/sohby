"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  cancelFriendRequestAction,
  respondFriendRequestAction,
  type FriendErrorCode,
} from "@/lib/friends/actions";
import type { FriendActionRunner } from "@/lib/friends/types";
import { Button } from "@/components/ui/button";
import { useBadges } from "@/components/app/badges";

/**
 * Gelen arkadaşlık isteği için "Kabul et / Reddet" ya da gönderilen istek için
 * "Geri çek". Arkadaşlar sayfası ve bildirim paneli kullanır.
 */
export function FriendRequestButtons(
  props: { kind: "incoming"; requestId: string; name: string } | { kind: "outgoing"; targetId: string; name: string },
) {
  const t = useTranslations("friends");
  const router = useRouter();
  const { refresh } = useBadges();
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<"accept" | "decline" | "cancel" | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | "cancelled" | null>(null);
  const [error, setError] = useState<FriendErrorCode | null>(null);

  const run = (kind: "accept" | "decline" | "cancel", action: FriendActionRunner) => {
    setError(null);
    setWhich(kind);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(kind === "accept" ? "accepted" : kind === "decline" ? "declined" : "cancelled");
      refresh();
      router.refresh();
    });
  };

  if (done) {
    return (
      <p role="status" className="text-sm text-muted">
        {t(`done.${done}`, { name: props.name })}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.kind === "incoming" ? (
        <>
          <Button
            size="sm"
            onClick={() => run("accept", () => respondFriendRequestAction(props.requestId, true))}
            pending={pending && which === "accept"}
            disabled={pending}
            aria-label={t("acceptFrom", { name: props.name })}
          >
            {t("accept")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("decline", () => respondFriendRequestAction(props.requestId, false))}
            pending={pending && which === "decline"}
            disabled={pending}
            aria-label={t("declineFrom", { name: props.name })}
          >
            {t("decline")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => run("cancel", () => cancelFriendRequestAction(props.targetId))}
          pending={pending}
          disabled={pending}
          aria-label={t("cancelTo", { name: props.name })}
        >
          {t("cancelShort")}
        </Button>
      )}
      {error && (
        <p role="alert" className="basis-full text-sm text-coral-text">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
