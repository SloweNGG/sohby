"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { respondToRequestAction, type RespondResult } from "@/lib/chat/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { useChats } from "@/components/chat/chats-shell";

/** "Kabul et" / "Reddet" (tasarim/09). */
export function RequestActions({ requestId, senderName }: { requestId: string; senderName: string }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { refresh } = useChats();
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<Extract<RespondResult, { ok: false }>["error"] | null>(null);
  const [declined, setDeclined] = useState(false);

  const respond = (accept: boolean) => {
    setError(null);
    setWhich(accept ? "accept" : "decline");
    startTransition(async () => {
      const result = await respondToRequestAction({ requestId, accept });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
      if (accept && result.conversationId) {
        router.replace(`/chats/${result.conversationId}`);
      } else {
        setDeclined(true);
        router.refresh();
      }
    });
  };

  if (declined) {
    return <FormAlert tone="info">{t("declined", { name: senderName })}</FormAlert>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4">
          <FormAlert>{t(`errors.${error}`)}</FormAlert>
        </div>
      )}
      <div className="flex gap-2.5">
        <Button size="lg" onClick={() => respond(true)} pending={pending && which === "accept"} disabled={pending}>
          {t("accept")}
        </Button>
        <Button variant="outline" size="lg" onClick={() => respond(false)} pending={pending && which === "decline"} disabled={pending}>
          {t("decline")}
        </Button>
      </div>
    </div>
  );
}
