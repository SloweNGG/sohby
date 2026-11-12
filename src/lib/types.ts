/** Veritabanı satırları ve RPC çıktıları için elle yazılmış tipler. */
import type { CountryCode } from "@/lib/data/countries";

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
  country_code: CountryCode;
  city: string | null;
  city_id: number | null;
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
  voice_permission: VoicePermission;
  show_friends: boolean;
  student_university_id: string | null;
  student_verified_until: string | null;
  show_university: boolean;
  show_outside_campus: boolean;
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

export type University = { id: string; name_tr: string; name_en: string; city: string };

/** get_my_campus() çıktısı. */
export type CampusMine = {
  verified: boolean;
  verified_until: string | null;
  university: University | null;
  show_university: boolean;
  show_outside_campus: boolean;
  latest: {
    status: "pending" | "approved" | "rejected" | "expired";
    university_id: string;
    created_at: string;
    reviewed_at: string | null;
    review_note: string | null;
  } | null;
};

/** Kampüs rozeti: doğrulanmış öğrenci; üniversite yalnızca sahibi izin verdiyse. */
export type StudentInfo = { university: { id: string; name_tr: string; name_en: string } | null };

/** private.profile_card çıktısı (gizlilik filtresinden geçmiş profil). */
export type ProfileCard = {
  id: string;
  username: string;
  display_name: string;
  age: number | null;
  gender: Exclude<Gender, "unspecified"> | null;
  country_code: CountryCode;
  city: string | null;
  district: string | null;
  occupation: string | null;
  bio: string | null;
  languages: LanguageCode[];
  /** Doğrulanmış öğrenciyse rozet bilgisi, değilse null. */
  student?: StudentInfo | null;
  looking_for: LookingFor[];
  is_online: boolean;
  member_since: string;
  /** Galeri: onaylı fotoğrafların depolama yolları, sırasıyla (ilki ana fotoğraf). */
  photo_paths?: string[];
  /** Galeri için sunucuda üretilen imzalı bağlantılar. */
  photo_urls?: string[];
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
  /** Benim engellediğim kişi: yalnızca ad, kullanıcı adı ve ana fotoğraf döner. */
  blocked_by_me?: boolean;
  blocked_at?: string | null;
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
  /** Mikrofon düğmesinin durumu ('disabled' → düğme hiç görünmez). */
  voice?: VoiceStatus;
  /** Karşı tarafın okuma zamanı — yalnızca iki taraf da okundu bilgisini açtıysa. */
  other_read_at?: string | null;
};

export type BlockedUser = {
  id: string | null;
  username: string | null;
  display_name: string | null;
  blocked_at: string;
  /** Ana fotoğraf (yalnızca normal engellerde). */
  photo_path?: string | null;
  photo_url?: string | null;
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

export type MessageKind = "text" | "photo" | "voice";

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** Eski kayıtlarda/Realtime'da yoksa 'text' sayılır. */
  kind?: MessageKind;
  photo_path?: string | null;
  voice_path?: string | null;
  /** Sesli mesajın süresi (ms, en çok 60 sn). */
  voice_duration_ms?: number | null;
  /** Ses dalgası çubukları (0–100). */
  voice_peaks?: number[] | null;
};

/** Kimler sana fotoğraf gönderebilir? */
export const PHOTO_PERMISSIONS = ["accepted_chats", "friends", "nobody"] as const;
export type PhotoPermission = (typeof PHOTO_PERMISSIONS)[number];

/** private.chat_photo_status sonucu. */
export type PhotoStatus = "ok" | "disabled" | "not_found" | "not_allowed" | "recipient_off" | "friends_only" | "not_accepted" | "rate_limited";

/** Kimler sana sesli mesaj gönderebilir? (fotoğraftan bağımsız) */
export const VOICE_PERMISSIONS = PHOTO_PERMISSIONS;
export type VoicePermission = PhotoPermission;

/** private.chat_voice_status sonucu (fotoğrafla aynı değerler). */
export type VoiceStatus = PhotoStatus;

export type MessageRequestItem = {
  id: string;
  body: string;
  is_flirt: boolean;
  created_at: string;
  sender: ProfileCard;
};

export type BadgeCounts = { unread_messages: number; pending_requests: number; unread_notifications: number };

/** Arkadaşlık durumu (izleyenin gözünden). */
export type FriendState = "self" | "friends" | "incoming" | "outgoing" | "none";

/** Listelerdeki küçük kişi kartı (private.friend_card). */
export type FriendCard = {
  id: string;
  username: string;
  display_name: string;
  photo_path: string | null;
  photo_url?: string | null;
  is_online: boolean;
};

/** get_friends çıktısı. */
export type FriendList = {
  visible: boolean;
  is_self: boolean;
  total: number;
  mutual_count: number;
  items: Array<FriendCard & { is_mutual: boolean; is_me: boolean; since: string }>;
};

/** get_profile_friends çıktısı. */
export type ProfileFriends = {
  state: FriendState;
  incoming_request_id: string | null;
  list: FriendList;
};

/** get_friend_requests çıktısı. */
export type FriendRequests = {
  incoming: Array<{ id: string; created_at: string; user: FriendCard }>;
  outgoing: Array<{ created_at: string; user: FriendCard }>;
};

export const NOTIFICATION_TYPES = [
  "friend_request",
  "friend_accepted",
  "message_request",
  "message_request_accepted",
  "anon_request",
  "student_approved",
  "student_rejected",
  "photo_approved",
  "photo_rejected",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** get_notifications öğesi. Anonim istekte `actor` her zaman null'dır (kural 10). */
export type NotificationItem = {
  id: string;
  type: NotificationType;
  created_at: string;
  read: boolean;
  actor: FriendCard | null;
  friend_request_id: string | null;
  friend_request_status: "pending" | "accepted" | "declined" | "cancelled" | null;
  friends: boolean;
  message_request_id: string | null;
  message_request_status: "pending" | "accepted" | "declined" | null;
  conversation_id: string | null;
  anon_conversation_id: string | null;
  anon_status: "pending" | "active" | "declined" | "revealed" | null;
};

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
