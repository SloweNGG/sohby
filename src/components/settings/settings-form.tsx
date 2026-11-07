"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { deleteAccountAction, saveSettingsAction, unblockUserAction } from "@/lib/settings/actions";
import { unblockAnonymousAction } from "@/lib/anon/actions";
import { useAlias } from "@/components/anon/alias";
import { MESSAGE_POLICIES, type BlockedUser, type MessagePolicy } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioDot } from "@/components/auth/signup-form";
import { cn } from "@/lib/cn";

export type SettingsInitial = {
  displayName: string;
  age: number | null;
  messagePolicy: MessagePolicy;
  showInDiscover: boolean;
  showAge: boolean;
  showDistrict: boolean;
  showGender: boolean;
  showOnline: boolean;
  showReadReceipts: boolean;
  acceptAnonymous: boolean;
  locale: Locale;
};

type ToggleKey =
  | "showInDiscover"
  | "showAge"
  | "showDistrict"
  | "showGender"
  | "showOnline"
  | "showReadReceipts"
  | "acceptAnonymous";

/** Ayarlar > Gizlilik (tasarim/11). Yalnızca çalışan ayarlar gösterilir. */
export function SettingsForm({
  initial,
  blocked,
  flirtSection,
  declinedSection,
}: {
  initial: SettingsInitial;
  blocked: BlockedUser[];
  flirtSection?: React.ReactNode;
  declinedSection?: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const tp = useTranslations("onboarding.privacy.policy");
  const tAnon = useTranslations("anon");
  const alias = useAlias();
  const router = useRouter();
  const pathname = usePathname();
  const [v, setV] = useState(initial);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [pending, startTransition] = useTransition();
  const [blockedList, setBlockedList] = useState(blocked);
  const [deleteError, setDeleteError] = useState(false);
  const [deleting, startDelete] = useTransition();
  const deleteRef = useRef<HTMLDialogElement>(null);

  const set = <K extends keyof SettingsInitial>(k: K, value: SettingsInitial[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    setStatus(null);
  };

  const save = () =>
    startTransition(async () => {
      const { displayName: _n, age: _a, ...input } = v;
      void _n;
      void _a;
      const result = await saveSettingsAction(input);
      setStatus(result.ok ? "saved" : "error");
      if (result.ok && v.locale !== initial.locale) router.replace(pathname, { locale: v.locale });
      else if (result.ok) router.refresh();
    });

  const toggles: Array<[ToggleKey, string, string]> = [
    ["showInDiscover", t("showInDiscover"), t("showInDiscoverHint")],
    ["showAge", t("showAge"), t("showAgeHint", { name: v.displayName, age: v.age ?? 25 })],
    ["showDistrict", t("showDistrict"), t("showDistrictHint")],
    ["showGender", t("showGender"), t("showGenderHint")],
    ["showOnline", t("showOnline"), t("showOnlineHint")],
    ["showReadReceipts", t("showReadReceipts"), t("showReadReceiptsHint")],
    ["acceptAnonymous", t("acceptAnonymous"), t("acceptAnonymousHint")],
  ];

  const card = (active: boolean) =>
    cn(
      "flex cursor-pointer items-start gap-4 rounded-2xl border px-5 py-4 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-lilac",
      active ? "border-coral bg-surface" : "border-edge bg-night-deep",
    );

  return (
    <div className="space-y-12">
      <form
        id="privacy"
        className="scroll-mt-6 space-y-10"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section>
          <h2 className="text-xl">{t("messagesTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("messagesHint")}</p>
          <div className="space-y-2.5" role="radiogroup" aria-label={t("messagesTitle")}>
            {MESSAGE_POLICIES.map((p) => (
              <label key={p} className={card(v.messagePolicy === p)}>
                <input type="radio" name="policy" className="sr-only" checked={v.messagePolicy === p} onChange={() => set("messagePolicy", p)} />
                <span className="mt-0.5">
                  <RadioDot checked={v.messagePolicy === p} />
                </span>
                <span>
                  <span className="block font-semibold">{tp(p)}</span>
                  <span className="block text-[13px] text-muted">{tp(`${p}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl">{t("visibleTitle")}</h2>
          <p className="mb-2 mt-1 text-sm text-muted">{t("visibleHint")}</p>
          <div className="divide-y divide-line border-y border-line">
            {toggles.map(([key, label, hint]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-6 py-4">
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-[13px] text-muted">{hint}</span>
                </span>
                <Checkbox checked={v[key]} onChange={(e) => set(key, e.target.checked)} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl">{t("languageTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("languageHint")}</p>
          <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={t("languageTitle")}>
            {(
              [
                ["tr", t("languageTr"), t("languageTrHint")],
                ["en", t("languageEn"), t("languageEnHint")],
              ] as const
            ).map(([l, label, hint]) => (
              <label key={l} className={card(v.locale === l)}>
                <input type="radio" name="locale" className="sr-only" checked={v.locale === l} onChange={() => set("locale", l)} />
                <span className="mt-0.5">
                  <RadioDot checked={v.locale === l} />
                </span>
                <span>
                  <span className="block font-semibold" lang={l}>
                    {label}
                  </span>
                  <span className="block text-[13px] text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="space-y-4 border-t border-line pt-6">
          {status === "saved" && <FormAlert tone="success">{t("saved")}</FormAlert>}
          {status === "error" && <FormAlert>{t("saveError")}</FormAlert>}
          <Button type="submit" size="lg" pending={pending}>
            {t("save")}
          </Button>
        </div>
      </form>

      {flirtSection}

      <section id="blocked" className="scroll-mt-6">
        <h2 className="text-xl">{t("blockedTitle")}</h2>
        <p className="mb-4 mt-1 text-sm text-muted">{t("blockedHint")}</p>
        {blockedList.length === 0 ? (
          <p className="text-sm text-muted">{t("blockedEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {blockedList.map((b) => {
              const key = b.id ?? b.anon_conversation_id ?? b.blocked_at;
              const isAnon = Boolean(b.anon_conversation_id);
              return (
                <li key={key} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {isAnon ? alias(b.alias_adjective ?? "", b.alias_animal ?? "") : b.display_name}
                    </span>
                    <span className="block truncate text-sm text-muted">{isAnon ? tAnon("badge") : `@${b.username}`}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const r = isAnon
                        ? await unblockAnonymousAction(b.anon_conversation_id as string)
                        : await unblockUserAction(b.id as string);
                      if (r.ok) setBlockedList((list) => list.filter((x) => x !== b));
                    }}
                  >
                    {t("unblock")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {declinedSection}

      <section id="account" className="scroll-mt-6">
        <h2 className="text-xl">{t("accountTitle")}</h2>
        <div className="mt-4 rounded-[20px] border border-edge p-5">
          <p className="font-semibold">{t("deleteTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t("deleteHint")}</p>
          <Button variant="danger" className="mt-4" onClick={() => deleteRef.current?.showModal()}>
            {t("deleteTitle")}
          </Button>
        </div>
        <dialog
          ref={deleteRef}
          aria-labelledby="delete-title"
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-6 text-moon backdrop:bg-black/60"
        >
          <h2 id="delete-title" className="text-xl">
            {t("deleteConfirmTitle")}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{t("deleteConfirmBody")}</p>
          {deleteError && (
            <div className="mt-4">
              <FormAlert>{t("deleteError")}</FormAlert>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => deleteRef.current?.close()}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              pending={deleting}
              onClick={() =>
                startDelete(async () => {
                  const r = await deleteAccountAction();
                  if (!r.ok) setDeleteError(true);
                  else {
                    router.replace("/");
                    router.refresh();
                  }
                })
              }
            >
              {t("deleteConfirm")}
            </Button>
          </div>
        </dialog>
      </section>
    </div>
  );
}
