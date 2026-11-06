/** Veritabanı satırları ve RPC çıktıları için elle yazılmış tipler. */

export type Gender = "female" | "male" | "other" | "unspecified";

export const LOOKING_FOR = [
  "chat",
  "friends",
  "hobby_buddy",
  "activity",
  "flirt",
  "new_in_town",
  "language_practice",
] as const;
export type LookingFor = (typeof LOOKING_FOR)[number];

export const LANGUAGES = [
  "tr", "en", "de", "fr", "es", "it", "ru", "ar", "ku", "az", "fa", "nl", "pt", "ja", "ko", "zh", "el", "bg",
] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

export const MESSAGE_POLICIES = ["everyone", "request_first", "common_hobby"] as const;
export type MessagePolicy = (typeof MESSAGE_POLICIES)[number];

export const DATING_INTERESTS = ["female", "male", "other"] as const;
export type DatingInterest = (typeof DATING_INTERESTS)[number];

/** public.profiles satırı (yalnızca sahibi okuyabilir). */
export type MyProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  gender: Gender;
  city: string | null;
  district: string | null;
  occupation: string | null;
  bio: string | null;
  looking_for: LookingFor[];
  dating_interest: DatingInterest[];
  languages: LanguageCode[];
  show_in_discover: boolean;
  show_age: boolean;
  show_district: boolean;
  show_gender: boolean;
  show_online: boolean;
  message_policy: MessagePolicy;
  onboarding_completed_at: string | null;
  created_at: string;
};

/** public.profile_private satırı. */
export type MyPrivateRow = {
  id: string;
  birth_date: string | null;
  age_check_failed_at: string | null;
  dating_consent_at: string | null;
  terms_accepted_at: string | null;
};

export type Hobby = { id: number; slug: string; name_tr: string; name_en: string };

/** private.profile_card çıktısı (gizlilik filtresinden geçmiş profil). */
export type ProfileCard = {
  id: string;
  username: string;
  display_name: string;
  age: number | null;
  gender: Exclude<Gender, "unspecified"> | null;
  city: string | null;
  district: string | null;
  occupation: string | null;
  bio: string | null;
  languages: LanguageCode[];
  looking_for: LookingFor[];
  is_online: boolean;
  member_since: string;
  common_hobby_count: number;
  hobbies: Array<{ slug: string; name_tr: string; name_en: string; common: boolean }>;
};

export type MessageMode = "conversation" | "direct" | "request" | "not_allowed";

/** public.get_profile çıktısı. */
export type ProfileDetail = ProfileCard & {
  is_self: boolean;
  message_mode: MessageMode;
  conversation_id: string | null;
  incoming_request_id: string | null;
  outgoing_request_pending: boolean;
  flirt_compatible: boolean;
};

export type ConversationListItem = {
  id: string;
  other: ProfileCard;
  last_message: { body: string; created_at: string; from_me: boolean } | null;
  unread_count: number;
};

export type ConversationHeader = {
  id: string;
  other: ProfileCard;
  can_send: boolean;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type MessageRequestItem = {
  id: string;
  body: string;
  is_flirt: boolean;
  created_at: string;
  sender: ProfileCard;
};

export type BadgeCounts = { unread_messages: number; pending_requests: number };
