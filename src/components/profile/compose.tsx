"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { startConversationAction } from "@/lib/chat/actions";
import type { ChatErrorCode } from "@/lib/chat/errors";
import { Button } from "@/components/ui/button";
import { FormAlert, Textarea } from "@/components/ui/field";

type ComposeContextValue = { open: (prefill?: string) => void };
const ComposeContext = createContext<ComposeContextValue>({ open: () => {} });

export function useCompose() {
  return useContext(ComposeContext);
}

/**
 * Profil sayfasındaki "Selam ver" penceresi. Mesaj, alıcının ayarına göre
 * doğrudan sohbet ya da mesaj isteği olarak gider (karar veritabanında).
 */
export function ComposeProvider({
  targetId,
  name,
  mode,
  autoOpen,
  children,
}: {
  targetId: string;
  name: string;
  mode: "direct" | "request";
  autoOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<ChatErrorCode | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const open = (prefill?: string) => {
    setError(null);
    setSent(false);
    if (prefill !== undefined) setBody(prefill);
    dialogRef.current?.showModal();
  };

  useEffect(() => {
    if (autoOpen) dialogRef.current?.showModal();
  }, [autoOpen]);

  const close = () => {
    dialogRef.current?.close();
    if (sent) router.refresh();
  };

  const send = () => {
    setError(null);
    startTransition(async () => {
      const result = await startConversationAction({ targetId, body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.kind === "conversation") {
        router.push(`/chats/${result.conversationId}`);
        return;
      }
      setSent(true);
      setBody("");
    });
  };

  return (
    <ComposeContext.Provider value={{ open }}>
      {children}
      <dialog
        ref={dialogRef}
        onClose={() => sent && router.refresh()}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-[var(--radius-card)] border border-edge bg-surface p-0 text-moon backdrop:bg-black/60"
        aria-labelledby="compose-title"
      >
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="compose-title" className="text-xl">
              {sent ? t("compose.sentTitle") : t("compose.title", { name })}
            </h2>
            <button type="button" onClick={close} className="-m-2 rounded-full p-2 text-muted hover:text-moon" aria-label={t("compose.cancel")}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {sent ? (
            <div>
              <p className="flex items-start gap-3 leading-relaxed text-muted">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-lilac" aria-hidden="true" />
                {t("compose.sentBody", { name })}
              </p>
              <div className="mt-6 flex justify-end">
                <Button onClick={close}>{t("compose.close")}</Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <Textarea
                autoFocus
                rows={4}
                maxLength={1000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("compose.placeholder")}
                aria-label={t("compose.placeholder")}
                className="bg-night-deep"
              />
              <div className="mt-2 flex justify-between gap-4 text-xs text-muted">
                <span>{mode === "request" ? t("compose.requestNote", { name }) : t("compose.directNote")}</span>
                <span className="shrink-0">{t("compose.count", { count: body.length, max: 1000 })}</span>
              </div>
              {error && (
                <div className="mt-4">
                  <FormAlert>{t(`errors.${error}`)}</FormAlert>
                </div>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>
                  {t("compose.cancel")}
                </Button>
                <Button type="submit" pending={pending} disabled={!body.trim()}>
                  {t("compose.send")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </ComposeContext.Provider>
  );
}

/** Profil sayfasındaki birincil "Selam ver / Mesaj gönder" butonu. */
export function ComposeButton({ children, className }: { children: ReactNode; className?: string }) {
  const { open } = useCompose();
  return (
    <button type="button" onClick={() => open()} className={className}>
      {children}
    </button>
  );
}

/** "Bu soruyla selam ver": pencereyi hazır metinle açar. */
export function IdeaButton({ prefill, children, className }: { prefill: string; children: ReactNode; className?: string }) {
  const { open } = useCompose();
  return (
    <button type="button" onClick={() => open(prefill)} className={className}>
      {children}
    </button>
  );
}
