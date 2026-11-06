"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, Flag, MoreHorizontal, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { blockUserAction, reportUserAction, type SafetyErrorCode } from "@/lib/safety/actions";
import { REPORT_REASONS, type ReportReason } from "@/lib/safety/reasons";
import { Button, buttonClasses } from "@/components/ui/button";
import { FormAlert, Textarea } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioDot } from "@/components/auth/signup-form";
import { cn } from "@/lib/cn";

type Variant = "links" | "buttons" | "menu";

type Props = {
  targetId: string;
  name: string;
  /** Engelledikten sonra gidilecek sayfa (ör. /discover, /chats). */
  afterBlockHref: string;
  conversationId?: string;
  requestId?: string;
  variant?: Variant;
  /** Menü butonu için ek sınıf (ör. fotoğraf üstünde koyu zemin). */
  menuClassName?: string;
};

/**
 * "Engelle" ve "Şikâyet et" eylemleri. Görünüm üç türlü:
 *  - links:   profil / istek ayrıntısındaki yazı bağlantıları (tasarim/07, 09)
 *  - buttons: sohbet başlığındaki çerçeveli butonlar (tasarim/08)
 *  - menu:    telefondaki "⋯" menüsü (tasarim/14, 15)
 */
export function SafetyActions({
  targetId,
  name,
  afterBlockHref,
  conversationId,
  requestId,
  variant = "links",
  menuClassName,
}: Props) {
  const t = useTranslations("safety");
  const blockRef = useRef<HTMLDialogElement>(null);
  const reportRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const openBlock = () => {
    if (menuRef.current) menuRef.current.open = false;
    blockRef.current?.showModal();
  };
  const openReport = () => {
    if (menuRef.current) menuRef.current.open = false;
    reportRef.current?.showModal();
  };

  return (
    <>
      {variant === "links" && (
        <div className="flex items-center gap-5 text-[15px]">
          <button type="button" onClick={openBlock} className="text-muted hover:text-moon">
            {t("block")}
          </button>
          <button type="button" onClick={openReport} className="text-coral-text hover:underline">
            {t("report")}
          </button>
        </div>
      )}

      {variant === "buttons" && (
        <>
          <button type="button" onClick={openBlock} className={buttonClasses({ variant: "outline", size: "md", className: "h-[42px] px-4" })}>
            <Ban className="h-4 w-4" aria-hidden="true" />
            {t("block")}
          </button>
          <button type="button" onClick={openReport} className={buttonClasses({ variant: "danger", size: "md", className: "h-[42px] px-4" })}>
            <Flag className="h-4 w-4" aria-hidden="true" />
            {t("report")}
          </button>
        </>
      )}

      {variant === "menu" && (
        <details ref={menuRef} className="relative">
          <summary
            className={cn(
              "grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-edge [&::-webkit-details-marker]:hidden",
              menuClassName,
            )}
            aria-label={t("more")}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-12 z-40 w-48 rounded-2xl border border-edge bg-surface p-1.5 shadow-xl">
            <button type="button" onClick={openBlock} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line">
              <Ban className="h-4 w-4" aria-hidden="true" />
              {t("block")}
            </button>
            <button type="button" onClick={openReport} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-coral-text hover:bg-line">
              <Flag className="h-4 w-4" aria-hidden="true" />
              {t("report")}
            </button>
          </div>
        </details>
      )}

      <BlockDialog dialogRef={blockRef} targetId={targetId} name={name} afterHref={afterBlockHref} />
      <ReportDialog
        dialogRef={reportRef}
        targetId={targetId}
        name={name}
        afterBlockHref={afterBlockHref}
        conversationId={conversationId}
        requestId={requestId}
      />
    </>
  );
}

const dialogClass =
  "m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-0 text-moon backdrop:bg-black/60";

function DialogHeader({ title, onClose, closeLabel, id }: { title: string; onClose: () => void; closeLabel: string; id: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <h2 id={id} className="text-xl leading-snug">
        {title}
      </h2>
      <button type="button" onClick={onClose} className="-m-2 rounded-full p-2 text-muted hover:text-moon" aria-label={closeLabel}>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

function BlockDialog({
  dialogRef,
  targetId,
  name,
  afterHref,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  targetId: string;
  name: string;
  afterHref: string;
}) {
  const t = useTranslations("safety");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<SafetyErrorCode | null>(null);
  const titleId = useId();
  const close = () => dialogRef.current?.close();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await blockUserAction({ targetId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.replace(afterHref);
      router.refresh();
    });
  };

  return (
    <dialog ref={dialogRef} className={dialogClass} aria-labelledby={titleId}>
      <div className="p-5 sm:p-6">
        <DialogHeader id={titleId} title={t("blockTitle", { name })} onClose={close} closeLabel={t("cancel")} />
        <p className="leading-relaxed text-muted">{t("blockBody")}</p>
        {error && (
          <div className="mt-4">
            <FormAlert>{t(`errors.${error}`)}</FormAlert>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button onClick={confirm} pending={pending}>
            <Ban className="h-4 w-4" aria-hidden="true" />
            {t("blockConfirm")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function ReportDialog({
  dialogRef,
  targetId,
  name,
  afterBlockHref,
  conversationId,
  requestId,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  targetId: string;
  name: string;
  afterBlockHref: string;
  conversationId?: string;
  requestId?: string;
}) {
  const t = useTranslations("safety");
  const router = useRouter();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  // Güvenli varsayılan: şikâyet edilen kişi ayrıca engellenir (kullanıcı kaldırabilir).
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [error, setError] = useState<SafetyErrorCode | "reason" | null>(null);
  const [done, setDone] = useState<null | { blocked: boolean }>(null);
  const [pending, startTransition] = useTransition();

  // Pencere her açılışta temiz başlasın.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      if (done?.blocked) {
        router.replace(afterBlockHref);
        router.refresh();
      }
      setReason(null);
      setNote("");
      setAlsoBlock(true);
      setError(null);
      setDone(null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [dialogRef, done, router, afterBlockHref]);

  const titleId = useId();
  const close = () => dialogRef.current?.close();

  const submit = () => {
    if (!reason) {
      setError("reason");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reportUserAction({
        targetId,
        reason,
        note: note || undefined,
        alsoBlock,
        conversationId,
        requestId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ blocked: alsoBlock });
    });
  };

  return (
    <dialog ref={dialogRef} className={cn(dialogClass, "max-w-lg")} aria-labelledby={titleId}>
      <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader
          id={titleId}
          title={done ? t("reportDoneTitle") : t("reportTitle", { name })}
          onClose={close}
          closeLabel={t("cancel")}
        />

        {done ? (
          <>
            <p className="flex items-start gap-3 leading-relaxed text-muted">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-lilac" aria-hidden="true" />
              {done.blocked ? t("reportDoneBlocked", { name }) : t("reportDone")}
            </p>
            <div className="mt-6 flex justify-end">
              <Button onClick={close}>{t("close")}</Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="text-sm text-muted">{t("reportIntro", { name })}</p>

            <fieldset className="mt-5">
              <legend className="mb-2.5 text-sm font-semibold">{t("reasonLabel")}</legend>
              <div className="space-y-2" role="radiogroup">
                {REPORT_REASONS.map((r) => (
                  <label
                    key={r}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-lilac",
                      reason === r ? "border-coral bg-line" : "border-edge bg-night-deep",
                    )}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r}
                      className="sr-only"
                      checked={reason === r}
                      onChange={() => {
                        setReason(r);
                        setError(null);
                      }}
                    />
                    <RadioDot checked={reason === r} />
                    {t(`reasons.${r}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold">
                {t("noteLabel")} <span className="font-normal text-muted">{t("noteOptional")}</span>
              </span>
              <Textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("notePlaceholder")}
                className="bg-night-deep"
              />
              <span className="mt-1 block text-right text-xs text-muted">{t("noteCount", { count: note.length })}</span>
            </label>

            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <Checkbox checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="block font-semibold">{t("alsoBlock")}</span>
                <span className="block text-[13px] text-muted">{t("alsoBlockHint")}</span>
              </span>
            </label>

            {error && (
              <div className="mt-4">
                <FormAlert>{error === "reason" ? t("reasonRequired") : t(`errors.${error}`)}</FormAlert>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t("cancel")}
              </Button>
              <Button type="submit" pending={pending}>
                <Flag className="h-4 w-4" aria-hidden="true" />
                {t("submit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
