"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { VenetianMask } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { undoDeclineAction } from "@/lib/settings/actions";
import type { DeclinedRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { InitialAvatar } from "@/components/profile/avatar";
import { useAlias } from "@/components/anon/alias";
import { useBadges } from "@/components/app/badges";

/**
 * Ayarlar > Reddedilen istekler. Gönderen reddi bilmez ve yeniden istek
 * gönderemez; reddeden burada reddi geri alabilir ya da kişiye kendisi yazabilir.
 */
export function DeclinedRequests({ initial }: { initial: DeclinedRequest[] }) {
  const t = useTranslations("settings");
  const tAnon = useTranslations("anon");
  const locale = useLocale();
  const alias = useAlias();
  const badges = useBadges();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const undo = (item: DeclinedRequest) => {
    setError(false);
    setPendingId(item.id);
    startTransition(async () => {
      const r = await undoDeclineAction(item.kind, item.id);
      setPendingId(null);
      if (!r.ok) return setError(true);
      setItems((list) => list.filter((x) => x.id !== item.id));
      badges.refresh();
    });
  };

  return (
    <section id="declined" className="scroll-mt-6">
      <h2 className="text-xl">{t("declinedTitle")}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t("declinedHint")}</p>
      {error && (
        <div className="mb-3">
          <FormAlert>{t("undoDeclineError")}</FormAlert>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("declinedEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex items-center gap-3 py-3">
              {item.kind === "request" ? (
                <InitialAvatar id={item.sender.id} name={item.sender.display_name} locale={locale} size={42} />
              ) : (
                <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-line text-lilac" aria-hidden="true">
                  <VenetianMask className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold">
                    {item.kind === "request" ? item.sender.display_name : alias(item.alias_adjective, item.alias_animal)}
                  </span>
                  {item.kind === "anonymous" && (
                    <span className="shrink-0 rounded-full border border-lilac px-2 py-px text-[11px] font-semibold text-lilac">{tAnon("badge")}</span>
                  )}
                  {item.kind === "request" && item.is_flirt && (
                    <span className="shrink-0 rounded-full border border-coral px-2 py-px text-[11px] font-semibold text-coral-text">{t("declinedFlirt")}</span>
                  )}
                </span>
                {item.body && <span className="block truncate text-sm text-muted">{item.body}</span>}
                {item.kind === "request" && (
                  <Link href={`/u/${item.sender.username}`} className="text-sm text-lilac hover:underline">
                    {t("viewProfile")}
                  </Link>
                )}
              </span>
              <Button variant="outline" size="sm" pending={pendingId === item.id} onClick={() => undo(item)}>
                {t("undoDecline")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
