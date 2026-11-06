/** Şikâyet nedenleri (veritabanındaki reports.reason kısıtıyla aynı). */
export const REPORT_REASONS = [
  "harassment",
  "spam",
  "inappropriate_content",
  "fake_profile",
  "underage",
  "scam",
  "hate_speech",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
