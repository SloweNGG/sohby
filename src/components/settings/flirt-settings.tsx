"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { disableFlirtAction, enableFlirtAction } from "@/lib/settings/actions";
import { DATING_INTERESTS, type DatingInterest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleChip } from "@/components/ui/chip";

/**
 * Flört aç/kapat. İlgi tercihi geri okunamaz (CLAUDE.md kural 11); bu yüzden
 * güncellerken seçimler boş başlar ve yeniden seçilir.
 */
export function FlirtSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings");
  const ti = useTranslations("datingInterest");
  const router = useRouter();
  const [interest, setInterest] = useState<DatingInterest[]>([]);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (interest.length === 0) return setMessage({ tone: "error", text: t("flirtNeedInterest") });
    if (!consent) return setMessage({ tone: "error", text: t("flirtNeedConsent") });
    startTransition(async () => {
      const r = await enableFlirtAction({ interestedIn: interest, consent: true });
      setMessage(r.ok ? { tone: "success", text: t("flirtSaved") } : { tone: "error", text: t("flirtError") });
      if (r.ok) {
        setInterest([]);
        setConsent(false);
        router.refresh();
      }
    });
  };

  const disable = () =>
    startTransition(async () => {
      const r = await disableFlirtAction();
      setMessage(r.ok ? { tone: "success", text: t("flirtDisabled") } : { tone: "error", text: t("flirtError") });
      if (r.ok) router.refresh();
    });

  return (
    <section id="flirt" className="scroll-mt-6">
      <h2 className="text-xl">{t("flirtTitle")}</h2>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-muted">{enabled ? t("flirtOnHint") : t("flirtOffHint")}</p>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">{t("flirtInterest")}</legend>
        <div className="flex flex-wrap gap-2">
          {DATING_INTERESTS.map((g) => (
            <ToggleChip
              key={g}
              selected={interest.includes(g)}
              onClick={() => {
                setMessage(null);
                setInterest((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
              }}
            >
              {ti(g)}
            </ToggleChip>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>{t("flirtConsent")}</span>
      </label>

      {message && (
        <div className="mt-4">
          <FormAlert tone={message.tone}>{message.text}</FormAlert>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={save} pending={pending}>
          {enabled ? t("flirtUpdate") : t("flirtEnable")}
        </Button>
        {enabled && (
          <Button variant="danger" onClick={disable} disabled={pending}>
            {t("flirtDisable")}
          </Button>
        )}
      </div>
    </section>
  );
}
