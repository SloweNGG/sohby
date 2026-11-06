export type ChatErrorCode =
  | "not_found"
  | "not_allowed"
  | "rate_limited"
  | "invalid_body"
  | "flirt_not_allowed"
  | "onboarding_required"
  | "email_not_verified"
  | "generic";

const KNOWN: ChatErrorCode[] = [
  "not_found",
  "not_allowed",
  "rate_limited",
  "invalid_body",
  "flirt_not_allowed",
  "onboarding_required",
  "email_not_verified",
];

/** Veritabanından gelen `raise exception '<kod>'` mesajını koda çevirir. */
export function toChatError(message: string | undefined): ChatErrorCode {
  return KNOWN.find((k) => message?.includes(k)) ?? "generic";
}
