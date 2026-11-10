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
  languages: LanguageCode[];
  show_in_discover: boolean;
  show_age: boolean;
  show_district: boolean;
  show_gender: boolean;
  show_online: boolean;
  message_policy: MessagePolicy;
  show_read_receipts: boolean;
  accept_anonymous: boolean;
  preferred_locale: "tr" | "en";
  photo_permission: PhotoPermission;
  photo_id: string | null;
  deleted_at: string | null;
  account_status: "active" | "age_verification_required" | "suspended" | "closed";
  status_reason: string | null;
  suspended_until: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
};

/** public.profile_private satırı. */
export type MyPrivateRow = {
  id: string;
  birth_date: string | null;
  age_check_failed_at: string | null;
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
  /** Onaylı profil fotoğrafının depolama yolu (yalnızca yetkili izleyenlere döner). */
  photo_path?: string | null;
  /** Sunucuda üretilen kısa ömürlü imzalı bağlantı. */
  photo_url?: string | null;
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
  last_message: { body: string; kind?: MessageKind; created_at: string; from_me: boolean } | null;
  unread_count: number;
};

export type ConversationHeader = {
  id: string;
  other: ProfileCard;
  can_send: boolean;
  /** Fotoğraf düğmesinin durumu ('disabled' → düğme hiç görünmez). */
  photo?: PhotoStatus;
  /** Karşı tarafın okuma zamanı — yalnızca iki taraf da okundu bilgisini açtıysa. */
  other_read_at?: string | null;
};

export type BlockedUser = {
  id: string | null;
  username: string | null;
  display_name: string | null;
  blocked_at: string;
  /** Anonim sohbetten yapılan engel: kimlik yerine takma ad döner. */
  anon_conversation_id?: string | null;
  alias_adjective?: string | null;
  alias_animal?: string | null;
};

/** get_declined_requests öğesi: benim reddettiğim istek (normal ya da anonim). */
export type DeclinedRequest =
  | {
      kind: "request";
      id: string;
      sender: ProfileCard;
      body: string;
      is_flirt: boolean;
      created_at: string;
      declined_at: string | null;
    }
  | {
      /** Anonim istek: gönderen hakkında yalnızca takma ad döner (kural 10). */
      kind: "anonymous";
      id: string;
      alias_adjective: string;
      alias_animal: string;
      body: string | null;
      created_at: string;
      declined_at: string | null;
    };

export type MessageKind = "text" | "photo";

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** Eski kayıtlarda/Realtime'da yoksa 'text' sayılır. */
  kind?: MessageKind;
  photo_path?: string | null;
};

/** Kimler sana fotoğraf gönderebilir? */
export const PHOTO_PERMISSIONS = ["accepted_chats", "nobody"] as const;
export type PhotoPermission = (typeof PHOTO_PERMISSIONS)[number];

/** private.chat_photo_status sonucu. */
export type PhotoStatus = "ok" | "disabled" | "not_found" | "not_allowed" | "recipient_off" | "not_accepted" | "rate_limited";

export type MessageRequestItem = {
  id: string;
  body: string;
  is_flirt: boolean;
  created_at: string;
  sender: ProfileCard;
};

export type BadgeCounts = { unread_messages: number; pending_requests: number };

/** Anonim sohbet (alıcıya gönderen hakkında yalnızca takma ad döner). */
export type AnonRole = "anonymous" | "recipient";
export type AnonConversationItem = {
  id: string;
  role: AnonRole;
  status: "pending" | "active" | "declined" | "revealed";
  alias_adjective: string;
  alias_animal: string;
  reveal_requested: boolean;
  created_at: string;
  recipient: ProfileCard | null;
  last_message: { body: string; created_at: string; from_me: boolean } | null;
  unread_count: number;
};
export type AnonConversationHeader = Omit<AnonConversationItem, "last_message" | "unread_count"> & {
  can_send: boolean;
  revealed_conversation_id: string | null;
};
export type AnonMessage = { id: string; conversation_id: string; from_anonymous: boolean; body: string; created_at: string };
