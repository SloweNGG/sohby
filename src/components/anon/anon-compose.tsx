"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { VenetianMask, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { startAnonymousAction, type AnonErrorCode } from "@/lib/anon/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { FormAlert, Textarea } from "@/components/ui/field";
import { useAlias } from "./alias";

/** "Anonim yaz" (tasarim/07, 15): kimlik gizli, mesaj istek olarak gider. */
export function AnonComposeButton({
  targetId,
  name,
  variant = "desktop",
}: {
  targetId: string;
  name: string;
  variant?: "desktop" | "mobile";
}) {
  const t = useTranslations("anon");
  const alias = useAlias();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<AnonErrorCode | null>(null);
  const [sent, setSent] = useState<{ id: string; alias: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const r = await startAnonymousAction(targetId, body);
      if (!r.ok) setError(r.error);
      else setSent({ id: r.id, alias: alias(r.aliasAdjective, r.aliasAnimal) });
    });

  return (
    <>
      {variant === "desktop" ? (
        <button type="button" onClick={() => ref.current?.showModal()} className={buttonClasses({ variant: "outline", size: "lg" })}>
          <VenetianMask className="h-5 w-5" aria-hidden="true" />
          {t("writeAnon")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.showModal()}
          className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border border-edge"
          aria-label={t("writeAnon")}
        >
          <VenetianMask className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-[var(--radius-card)] border border-edge bg-surface p-0 text-moon backdrop:bg-black/60"
      >
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl">
              {sent ? t("sentTitle") : t("composeTitle", { name })}
            </h2>
            <button type="button" onClick={() => ref.current?.close()} className="-m-2 rounded-full p-2 text-muted hover:text-moon" aria-label={t("cancel")}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {sent ? (
            <>
              <p className="leading-relaxed text-muted">{t("sentBody", { alias: sent.alias })}</p>
              <div className="mt-6 flex justify-end">
                <Link href={`/chats/anon/${sent.id}`} className={buttonClasses()}>
                  {t("openThread")}
                </Link>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <p className="mb-4 text-sm leading-relaxed text-muted">{t("composeNote", { name })}</p>
              <Textarea
                rows={4}
                maxLength={1000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-label={t("composeTitle", { name })}
                className="bg-night-deep"
              />
              {error && (
                <div className="mt-4">
                  <FormAlert>{t(`errors.${error}`)}</FormAlert>
                </div>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => ref.current?.close()}>
                  {t("cancel")}
                </Button>
                <Button type="submit" pending={pending} disabled={!body.trim()}>
                  <VenetianMask className="h-4 w-4" aria-hidden="true" />
                  {t("writeAnon")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
