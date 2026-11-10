"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, ChevronLeft, ImagePlus, Lock, RotateCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { isDuplicateKey, markFailed, mergeById, resyncCursor } from "@/lib/realtime/messages";
import { cn } from "@/lib/cn";
import { InitialAvatar } from "@/components/profile/avatar";
import { useBadges } from "@/components/app/badges";
import { useChats } from "./chats-shell";
import { useClock, useDayKey, useDayLabel } from "./time";
import { ChatPhoto } from "./chat-photo";
import { PHOTO_ACCEPT, checkPhotoFile, isRetryable, statusAfterError, type PhotoSendError } from "@/lib/chat/photo";
import { resizePhoto, sendChatPhoto } from "@/lib/chat/photo-client";
import type { ConversationHeader, Message, PhotoStatus } from "@/lib/types";

const PAGE = 50;
const RESYNC_PAGE = 200;
const SELECT = "id, conversation_id, sender_id, body, created_at, kind, photo_path";
const MAX_LENGTH = 2000;

type UiMessage = Message & { status?: "sending" | "failed"; error?: SendError; localUrl?: string };
type SendError = "rate_limited" | "not_allowed" | "too_long" | "generic" | PhotoSendError;

function toSendError(error: { message?: string; code?: string } | null): SendError {
  if (!error) return "generic";
  if (error.message?.includes("rate_limited")) return "rate_limited";
  if (error.code === "42501" || error.message?.includes("row-level security")) return "not_allowed";
  if (error.code === "23514") return "too_long";
  return "generic";
}

/**
 * Sunucu kaydı geçici fotoğraf mesajının yerini aldığında yerel önizleme
 * korunur (imzalı bağlantı beklenirken fotoğraf kaybolup gelmesin).
 */
function keepPreviews(prev: UiMessage[], next: UiMessage[]): UiMessage[] {
  if (next === prev) return prev;
  const local = new Map(prev.filter((m) => m.localUrl).map((m) => [m.id, m.localUrl as string]));
  if (local.size === 0) return next;
  return next.map((m) => (!m.localUrl && local.has(m.id) ? { ...m, localUrl: local.get(m.id) } : m));
}

/**
 * Birebir sohbet ekranı (masaüstü: tasarim/08, telefon: tasarim/14).
 * - Yeni mesajlar Supabase Realtime ile anında gelir (yalnızca bu sohbet,
 *   RLS ile yetkilendirilmiş). Kanal koparsa yeniden abone olunur; abone
 *   olunca, sekme görünür olunca ve internet geri gelince son mesajdan
 *   sonrası veritabanından tamamlanır (bkz. lib/realtime).
 * - Mesajlar kimliğe göre tekilleştirilir; kimliği gönderen üretir.
 * - Gönderim iyimserdir: mesaj hemen görünür, hata olursa "tekrar dene"
 *   (aynı kimlikle; mesaj iki kez yazılamaz).
 * - Sohbet açıkken ve sekme görünürken okundu olarak işaretlenir.
 * - Fotoğraf: tarayıcıda küçültülür, `chat-photos` Edge Function'ına gider
 *   (kurallar sunucuda). Düğme, özellik kapalıysa hiç görünmez; kural izin
 *   vermiyorsa kilitli görünür ve basınca nedenini söyler.
 */
export function ChatRoom({
  me,
  header,
  initialMessages,
  initialHasMore,
  headerActions,
  mobileMenu,
}: {
  me: string;
  header: ConversationHeader;
  initialMessages: Message[];
  initialHasMore: boolean;
  headerActions?: ReactNode;
  mobileMenu?: ReactNode;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const { refresh: refreshList } = useChats();
  const { refresh: refreshBadges } = useBadges();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(header.other_read_at ?? null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>(header.photo ?? "disabled");
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Gönderilen fotoğrafların "tekrar dene" için dosyası ve bırakılacak yerel önizlemeler.
  const photoBlobs = useRef(new Map<string, Blob>());
  const previewUrls = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clock = useClock();
  const dayKey = useDayKey();
  const dayLabel = useDayLabel();
  const conversationId = header.id;
  const other = header.other;
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await createClient().rpc("mark_conversation_read", { p_conversation: conversationId });
      refreshList();
      refreshBadges();
    } catch {
      /* sessizce geç */
    }
  }, [conversationId, refreshList, refreshBadges]);

  // Başlık bilgisi: okundu (iki taraf da açtıysa) ve fotoğraf düğmesinin durumu.
  const refreshHeader = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const { data } = await createClient().rpc("get_conversation", { p_conversation: conversationId });
      if (!data) return;
      const h = data as ConversationHeader;
      setOtherReadAt(h.other_read_at ?? null);
      setPhotoStatus(h.photo ?? "disabled");
    } catch {
      /* sessizce geç */
    }
  }, [conversationId]);

  // Sohbet açıkken periyodik tazelenir.
  useEffect(() => {
    const timer = window.setInterval(() => void refreshHeader(), 20_000);
    return () => window.clearInterval(timer);
  }, [refreshHeader]);

  // Yerel önizlemeler sayfadan çıkınca bırakılır.
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Okundu işaretle: açılışta ve sekmeye dönünce.
  useEffect(() => {
    void markRead();
    const onVisible = () => void markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // Realtime: bu sohbete gelen yeni mesajlar (kimliğe göre tekilleştirilir).
  const receive = useCallback(
    (incoming: Message[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => keepPreviews(prev, mergeById(prev, incoming)));
      const known = new Set(messagesRef.current.map((m) => m.id));
      if (incoming.some((m) => m.sender_id !== me && !known.has(m.id))) {
        void markRead();
        // Karşı taraf yazdı: sohbeti kabul etmiş sayılır, fotoğraf düğmesi açılabilir.
        void refreshHeader();
      }
    },
    [me, markRead, refreshHeader],
  );

  // Eksik tamamlama: son onaylı mesajdan (küçük bir payla) sonrasını çek.
  const resync = useCallback(async () => {
    const cursor = resyncCursor(messagesRef.current);
    const supabase = createClient();
    let from = cursor;
    for (let page = 0; page < 5; page += 1) {
      let q = supabase.from("messages").select(SELECT).eq("conversation_id", conversationId);
      if (from) q = q.gte("created_at", from);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(RESYNC_PAGE);
      if (error || !data) return;
      receive(data as Message[]);
      if (data.length < RESYNC_PAGE) return;
      from = (data[data.length - 1] as Message).created_at;
    }
  }, [conversationId, receive]);

  useRealtime({
    name: `conversation:${conversationId}`,
    bindings: [{ event: "INSERT", table: "messages", filter: `conversation_id=eq.${conversationId}` }],
    onEvent: (payload) => receive([payload.new as unknown as Message]),
    onResync: () => void resync().catch(() => {}),
  });

  // Yeni mesajda en alta kaydır (kullanıcı yukarıda geçmişi okumuyorsa).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  async function loadOlder() {
    const oldest = messages.find((m) => !m.status);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const { data } = await createClient()
        .from("messages")
        .select(SELECT)
        .eq("conversation_id", conversationId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      const older = ((data ?? []) as Message[]).reverse();
      setHasMore(older.length === PAGE);
      stickToBottom.current = false;
      setMessages((prev) => mergeById(prev, older));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string, retryId?: string) {
    const text = body.trim();
    if (!text) return;
    if (text.length > MAX_LENGTH) return;
    // Kimliği biz üretiriz: Realtime / eksik tamamlama / sunucu yanıtı aynı
    // kaydı getirir ve tekilleşir. Tekrar denemede aynı kimlik kullanılır.
    const id = retryId ?? crypto.randomUUID();
    const optimistic: UiMessage = {
      id,
      conversation_id: conversationId,
      sender_id: me,
      body: text,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    stickToBottom.current = true;
    setMessages((prev) => (retryId ? prev.map((m) => (m.id === retryId ? optimistic : m)) : [...prev, optimistic]));

    const supabase = createClient();
    let { data, error } = await supabase
      .from("messages")
      .insert({ id, conversation_id: conversationId, body: text })
      .select(SELECT)
      .single();
    if (isDuplicateKey(error)) {
      // Önceki deneme aslında yazılmış (yanıt yolda kaybolmuş): kaydı getir.
      ({ data, error } = await supabase.from("messages").select(SELECT).eq("id", id).single());
    }
    if (error || !data) {
      setMessages((prev) => markFailed(prev, id, toSendError(error)));
      return;
    }
    setMessages((prev) => mergeById(prev, [data as Message]));
    refreshList();
  }

  /** Fotoğraf gönder (yeni ya da "tekrar dene" ile aynı kimlik ve dosya). */
  async function sendPhoto(blob: Blob, retryId?: string) {
    const id = retryId ?? crypto.randomUUID();
    const existing = retryId ? messagesRef.current.find((m) => m.id === retryId)?.localUrl : undefined;
    const localUrl = existing ?? URL.createObjectURL(blob);
    previewUrls.current.add(localUrl);
    photoBlobs.current.set(id, blob);
    const optimistic: UiMessage = {
      id,
      conversation_id: conversationId,
      sender_id: me,
      body: "",
      kind: "photo",
      photo_path: null,
      created_at: new Date().toISOString(),
      status: "sending",
      localUrl,
    };
    stickToBottom.current = true;
    setMessages((prev) => (retryId ? prev.map((m) => (m.id === retryId ? optimistic : m)) : [...prev, optimistic]));

    const result = await sendChatPhoto(conversationId, id, blob);
    if (!result.ok) {
      setMessages((prev) => markFailed(prev, id, result.error as SendError));
      setPhotoStatus((s) => statusAfterError(result.error, s));
      return;
    }
    photoBlobs.current.delete(id);
    setMessages((prev) => keepPreviews(prev, mergeById(prev, [result.message])));
    refreshList();
  }

  async function onPhotoChosen(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const problem = checkPhotoFile(file);
    if (problem) {
      setPhotoNotice(t(`errors.${problem}`));
      return;
    }
    setPhotoNotice(null);
    let blob: Blob;
    try {
      blob = await resizePhoto(file);
    } catch {
      setPhotoNotice(t("errors.invalid_image"));
      return;
    }
    await sendPhoto(blob);
  }

  function onPhotoButton() {
    if (photoStatus === "ok") {
      setPhotoNotice(null);
      fileRef.current?.click();
      return;
    }
    // Kilitli: nedenini söyle (tekrar basınca kapanır).
    const key =
      photoStatus === "not_accepted" || photoStatus === "recipient_off" || photoStatus === "rate_limited"
        ? photoStatus
        : "not_allowed";
    const reason = t(`photo.locked.${key}`);
    setPhotoNotice((cur) => (cur === reason ? null : reason));
  }

  function retry(m: UiMessage) {
    if (m.kind === "photo") {
      const blob = photoBlobs.current.get(m.id);
      if (blob) void sendPhoto(blob, m.id);
      return;
    }
    void send(m.body, m.id);
  }

  function submit() {
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    void send(text);
    textareaRef.current?.focus();
  }

  // Metin kutusunu içeriğe göre büyüt.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const place = [other.district, other.city].filter(Boolean).join(", ");
  const lastMineIndex = messages.findLastIndex((x) => x.sender_id === me && !x.status);
  const tooLong = draft.trim().length > MAX_LENGTH;
  const showPhotoButton = photoStatus !== "disabled" && photoStatus !== "not_found";
  const photoLocked = photoStatus !== "ok";

  return (
    <div className="flex h-dvh flex-col">
      {/* Başlık */}
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 md:px-7 md:py-4">
        <Link
          href="/chats"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-moon hover:bg-surface md:hidden"
          aria-label={t("back")}
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </Link>
        <Link href={`/u/${other.username}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={t("viewProfile")}>
          <InitialAvatar id={other.id} name={other.display_name} locale={locale} size={46} />
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold leading-tight tracking-[-0.02em]">{other.display_name}</span>
            {other.is_online ? (
              <span className="block text-[13px] font-semibold text-online md:hidden">{t("online")}</span>
            ) : null}
            <span className={cn("truncate text-[13px] text-muted", other.is_online ? "hidden md:block" : "block")}>
              {place}
            </span>
          </span>
        </Link>
        {headerActions ? <div className="hidden shrink-0 items-center gap-2 md:flex">{headerActions}</div> : null}
        {mobileMenu ? <div className="md:hidden">{mobileMenu}</div> : null}
      </header>

      {/* Mesajlar */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-4 md:px-7"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="mx-auto flex min-h-full max-w-[920px] flex-col justify-end gap-2.5">
          {hasMore ? (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="mx-auto mb-2 rounded-full border border-edge px-4 py-1.5 text-sm text-muted hover:text-moon disabled:opacity-60"
            >
              {t("loadOlder")}
            </button>
          ) : (
            <p className="mx-auto mb-4 max-w-sm text-center text-xs leading-relaxed text-muted">{t("start")}</p>
          )}

          {messages.map((m, i) => {
            const mine = m.sender_id === me;
            const showRead =
              mine && i === lastMineIndex && otherReadAt !== null && new Date(otherReadAt) >= new Date(m.created_at);
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            return (
              <div key={m.id} className="flex flex-col">
                {newDay && (
                  <p className="my-2 text-center text-[13px] text-muted" suppressHydrationWarning>
                    {dayLabel(m.created_at)}
                  </p>
                )}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  {m.kind === "photo" ? (
                    <div
                      className={cn("max-w-[85%] rounded-[22px] md:max-w-[65%]", m.status === "failed" && "ring-2 ring-coral/60")}
                      title={clock(m.created_at)}
                    >
                      <ChatPhoto
                        path={m.photo_path}
                        localUrl={m.localUrl}
                        mine={mine}
                        sending={m.status === "sending"}
                      />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "max-w-[85%] rounded-[22px] px-[18px] py-3 text-[15px] leading-snug md:max-w-[65%] md:text-base",
                        mine ? "bg-coral text-ink" : "bg-surface text-moon",
                        m.status === "sending" && "opacity-70",
                        m.status === "failed" && "ring-2 ring-coral/60",
                      )}
                      title={clock(m.created_at)}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    </div>
                  )}
                </div>
                {showRead && <p className="mt-1 text-right text-xs text-muted">{t("read")}</p>}
                {m.status === "failed" && (
                  <p className="mt-1 flex items-center justify-end gap-2 text-xs text-coral-text">
                    {t(`errors.${m.error ?? "generic"}`)}
                    {(m.kind === "photo"
                      ? isRetryable((m.error ?? "generic") as PhotoSendError)
                      : m.error !== "not_allowed") && (
                      <button
                        type="button"
                        onClick={() => retry(m)}
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                      >
                        <RotateCw className="h-3 w-3" aria-hidden="true" />
                        {t("retry")}
                      </button>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Yazma alanı */}
      <div className="border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:border-t-0 md:px-7 md:pb-6">
        {header.can_send ? (
          <form
            className="mx-auto flex max-w-[920px] items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {showPhotoButton && (
              <>
                <button
                  type="button"
                  onClick={onPhotoButton}
                  aria-disabled={photoLocked}
                  aria-label={photoLocked ? t("photo.buttonLocked") : t("photo.button")}
                  className={cn(
                    "relative grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border border-edge text-moon transition-colors hover:bg-surface",
                    photoLocked && "text-muted",
                  )}
                >
                  <ImagePlus className="h-5 w-5" aria-hidden="true" />
                  {photoLocked && (
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border border-edge bg-night-deep">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={PHOTO_ACCEPT.join(",")}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => void onPhotoChosen(e.target.files?.[0])}
                />
              </>
            )}
            <label className="flex-1">
              <span className="sr-only">{t("placeholder")}</span>
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("placeholder")}
                className={cn(
                  "block max-h-40 min-h-[52px] w-full resize-none rounded-2xl border border-edge bg-surface px-5 py-[14px] text-[15px] leading-snug outline-none placeholder:text-muted focus:border-lilac/80",
                  tooLong && "border-coral",
                )}
                aria-invalid={tooLong}
              />
            </label>
            <button
              type="submit"
              disabled={!draft.trim() || tooLong}
              className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-coral text-ink transition-colors hover:bg-coral/90 disabled:opacity-50"
              aria-label={t("send")}
            >
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <p className="mx-auto max-w-[920px] rounded-2xl border border-edge bg-surface px-4 py-3 text-center text-sm text-muted">
            {t("cannotSend")}
          </p>
        )}
        {tooLong && <p className="mx-auto mt-2 max-w-[920px] text-xs text-coral-text">{t("errors.too_long")}</p>}
        {photoNotice && header.can_send && (
          <p className="mx-auto mt-2 max-w-[920px] text-xs text-muted" role="status">
            {photoNotice}
          </p>
        )}
      </div>
    </div>
  );
}
