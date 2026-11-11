"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { unblockUserAction } from "@/lib/settings/actions";
import { unblockAnonymousAction } from "@/lib/anon/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";

/**
 * "Engeli kaldır" + onay penceresi. Normal kişi (targetId) ya da anonim sohbet
 * (anonConversationId). Başarıda onDone çağrılır; verilmezse sayfa yenilenir.
 */
export function UnblockButton({
  targetId,
  anonConversationId,
  name,
  onDone,
  size = "sm",
}: {
  targetId?: string;
  anonConversationId?: string;
  name: string;
  onDone?: () => void;
  size?: "sm" | "md";
}) {
  const t = useTranslations("safety");
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const close = () => ref.current?.close();

  const confirm = () =>
    startTransition(async () => {
      setError(false);
      const r = anonConversationId
        ? await unblockAnonymousAction(anonConversationId)
        : await unblockUserAction(targetId ?? "");
      if (!r.ok) {
        setError(true);
        return;
      }
      close();
      if (onDone) onDone();
      else router.refresh();
    });

  return (
    <>
      <Button variant="outline" size={size} onClick={() => ref.current?.showModal()}>
        {t("unblock")}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-0 text-moon backdrop:bg-black/60"
      >
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl leading-snug">
              {t("unblockTitle", { name })}
            </h2>
            <button type="button" onClick={close} className="-m-2 rounded-full p-2 text-muted hover:text-moon" aria-label={t("cancel")}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="leading-relaxed text-muted">{t("unblockBody")}</p>
          {error && (
            <div className="mt-4">
              <FormAlert>{t("errors.generic")}</FormAlert>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t("cancel")}
            </Button>
            <Button onClick={confirm} pending={pending}>
              {t("unblockConfirm")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
