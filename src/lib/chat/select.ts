/** Sohbet ekranlarının mesaj sütunları (sayfa ilk yüklemesi, eksik tamamlama, daha eskiler). */
export const MESSAGE_SELECT =
  "id, conversation_id, sender_id, body, created_at, kind, photo_path, voice_path, voice_duration_ms, voice_peaks, sender_reaction, recipient_reaction, updated_at";

/** Anonim sohbet mesaj sütunları (kişi kimliği yok; kural 10). */
export const ANON_MESSAGE_SELECT =
  "id, conversation_id, from_anonymous, body, created_at, sender_reaction, recipient_reaction, updated_at";
