import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["tr", "en"],
  defaultLocale: "tr",
  // Türkçe adresler önek almaz (/kesfet yerine /discover gibi sade yollar);
  // İngilizce /en/... altında sunulur.
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
