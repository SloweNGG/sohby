"use client";

import { useTranslations } from "next-intl";

/** Rastgele takma adın yerelleştirilmiş hâli (ör. "Gizli Tilki" / "Secret Fox"). */
export function useAlias() {
  const t = useTranslations("anon");
  return (adjective: string, animal: string) => {
    const a = t.has(`adjectives.${adjective}` as never) ? t(`adjectives.${adjective}` as never) : adjective;
    const n = t.has(`animals.${animal}` as never) ? t(`animals.${animal}` as never) : animal;
    return t("alias", { adjective: a, animal: n });
  };
}
