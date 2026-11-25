/**
 * "Yazıyor…" göstergesi (React'ten bağımsız; Node ile test edilir).
 *
 * Supabase Realtime Broadcast ile ÖZEL kanal kullanır:
 *   typing:c:<sohbet kimliği>         normal sohbet
 *   typing:a:<anonim sohbet kimliği>  anonim sohbet
 * Kimin katılıp gönderebileceğini veritabanı kuralları belirler
 * (migration 20261125000100_typing_indicator). Hiçbir şey veritabanına yazılmaz.
 *
 * Mesaj kanalından (keeper.ts) farkı: iki taraf AYNI kanal adına katılmak
 * zorunda, benzersiz son ek kullanılamaz. supabase-js aynı adlı kanal varsa
 * onu döndürür ve kapanan kanalı listeden ADINA göre siler (aynı adlı yeni
 * kanalı da siler). Bu yüzden aynı ad için önceki kanalın kapanması
 * (removeChannel) bitmeden yenisi açılmaz.
 *
 * Yük yalnızca yazan tarafı taşır (`side`): normal sohbette kullanıcı kimliği
 * (taraflar birbirini zaten tanır), anonim sohbette "anon" / "recipient"
 * (kural 10: kimlik yok). Aynı kişinin başka sekmesi kendi sinyalini bu sayede
 * yok sayar.
 */
/** Yeniden bağlanma beklemesi: keeper.ts ile aynı (1, 2, 4 … en çok 30 sn). */
const backoffMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));

export const TYPING_EVENT = "typing";
/** Yazmaya devam ederken en fazla bu sıklıkta sinyal gönderilir. */
export const TYPING_SEND_EVERY_MS = 3000;
/** Yeni sinyal gelmezse gösterge bu süre sonra kendiliğinden kapanır. */
export const TYPING_SHOW_MS = 6000;

export type TypingSignal = "typing" | "stop";
type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
type Timers = {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

const defaultSet = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const defaultClear = (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>);

export function typingTopic(kind: "conversation" | "anon", id: string): string {
  return `typing:${kind === "anon" ? "a" : "c"}:${id}`;
}

/**
 * Gönderen taraf: her tuşta değil, yazmaya başlayınca bir kez ve sürdükçe
 * en fazla `everyMs`'de bir "typing" gönderir. Taslak silinince "stop".
 */
export function createTypingSender(opts: {
  send: (signal: TypingSignal) => void;
  now?: () => number;
  everyMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const everyMs = opts.everyMs ?? TYPING_SEND_EVERY_MS;
  let active = false;
  let lastSent = 0;

  return {
    /** Kullanıcı taslağı değiştirdi. */
    input(text: string) {
      if (!text.trim()) {
        this.reset();
        return;
      }
      const t = now();
      if (!active || t - lastSent >= everyMs) {
        active = true;
        lastSent = t;
        opts.send("typing");
      }
    },
    /**
     * Mesaj gönderildi: "stop" gönderilmez (karşı tarafta gösterge, mesaj
     * gelince kapanır); bir sonraki tuş hemen yeni sinyal gönderir.
     */
    sent() {
      active = false;
      lastSent = 0;
    },
    /** Taslak boşaldı, sekme gizlendi ya da sayfadan çıkılıyor. */
    reset() {
      if (!active) return;
      active = false;
      lastSent = 0;
      opts.send("stop");
    },
  };
}

/** Alan taraf: "typing" gelince açılır, `showMs` içinde yenilenmezse kapanır. */
export function createTypingReceiver(opts: { onChange: (typing: boolean) => void; showMs?: number } & Timers) {
  const setTimer = opts.setTimer ?? defaultSet;
  const clearTimer = opts.clearTimer ?? defaultClear;
  const showMs = opts.showMs ?? TYPING_SHOW_MS;
  let on = false;
  let timer: unknown = null;

  const set = (value: boolean) => {
    if (value === on) return;
    on = value;
    opts.onChange(value);
  };
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  return {
    signal(signal: TypingSignal) {
      cancel();
      if (signal === "stop") {
        set(false);
        return;
      }
      set(true);
      timer = setTimer(() => {
        timer = null;
        set(false);
      }, showMs);
    },
    /** Karşı tarafın mesajı geldi ya da kanal koptu. */
    clear() {
      cancel();
      set(false);
    },
    dispose() {
      cancel();
    },
  };
}

export type TypingChannelLike = {
  topic: string;
  on(
    type: "broadcast",
    filter: { event: string },
    callback: (message: { payload?: Record<string, unknown> }) => void,
  ): TypingChannelLike;
  subscribe(callback: (status: string, err?: Error) => void): TypingChannelLike;
  send(message: { type: "broadcast"; event: string; payload: Record<string, unknown> }): Promise<unknown>;
};

export type TypingClientLike = {
  channel(
    topic: string,
    params: { config: { private: boolean; broadcast: { self: boolean; ack: boolean } } },
  ): TypingChannelLike;
  removeChannel(channel: TypingChannelLike): Promise<unknown>;
  getChannels(): TypingChannelLike[];
};

/** İstemci başına, adı → o addaki kanalın süren kapanışı. */
const closing = new WeakMap<object, Map<string, Promise<unknown>>>();
function closingFor(client: object) {
  let map = closing.get(client);
  if (!map) {
    map = new Map();
    closing.set(client, map);
  }
  return map;
}

export function createTypingChannel(
  opts: {
    client: TypingClientLike;
    topic: string;
    /** Bu tarafın etiketi; aynı etiketli sinyaller yok sayılır. */
    side: string;
    onSignal: (signal: TypingSignal) => void;
    onStatus?: (status: Status, err?: Error) => void;
    /** Abone olmadan önce (ör. Realtime yetkisini tazelemek için). */
    beforeSubscribe?: () => Promise<void>;
  } & Timers,
) {
  const setTimer = opts.setTimer ?? defaultSet;
  const clearTimer = opts.clearTimer ?? defaultClear;
  const fullTopic = `realtime:${opts.topic}`;
  const pending = closingFor(opts.client);

  let channel: TypingChannelLike | null = null;
  let subscribed = false;
  let stopped = false;
  let generation = 0;
  let attempt = 0;
  let timer: unknown = null;

  /** Kanalı kapatır; aynı addaki sonraki açılış bu kapanışı bekler. */
  const remove = (ch: TypingChannelLike) => {
    const before = pending.get(opts.topic);
    const done: Promise<unknown> = Promise.all([before, opts.client.removeChannel(ch).catch(() => {})]).then(() => {
      if (pending.get(opts.topic) === done) pending.delete(opts.topic);
    });
    pending.set(opts.topic, done);
  };

  const drop = () => {
    const old = channel;
    channel = null;
    subscribed = false;
    if (old) remove(old);
  };

  const scheduleReconnect = () => {
    if (stopped || timer !== null) return;
    attempt += 1;
    timer = setTimer(() => {
      timer = null;
      void open();
    }, backoffMs(attempt));
  };

  async function open() {
    if (stopped) return;
    drop();
    const gen = ++generation;
    await pending.get(opts.topic);
    try {
      await opts.beforeSubscribe?.();
    } catch {
      /* yetki tazelenemezse yine de denenir; hata durumunda yeniden denenecek */
    }
    if (stopped || gen !== generation) return;
    const leftover = opts.client.getChannels().find((c) => c.topic === fullTopic);
    if (leftover) {
      // Sunucu ayrılmayı onaylamadı, eski kanal hâlâ listede: onu kapat, biraz sonra yeniden dene.
      remove(leftover);
      scheduleReconnect();
      return;
    }
    const ch = opts.client
      .channel(opts.topic, { config: { private: true, broadcast: { self: false, ack: false } } })
      .on("broadcast", { event: TYPING_EVENT }, (message) => {
        if (stopped || gen !== generation || channel !== ch) return;
        const p = message.payload;
        if (!p || typeof p.side !== "string" || p.side === opts.side) return;
        opts.onSignal(p.state === "stop" ? "stop" : "typing");
      });
    channel = ch;
    ch.subscribe((raw, err) => {
      // Eski (değiştirilmiş ya da kapatılmış) kanaldan gelen durumlar yok sayılır.
      if (stopped || gen !== generation || channel !== ch) return;
      const status = raw as Status;
      opts.onStatus?.(status, err);
      if (status === "SUBSCRIBED") {
        subscribed = true;
        attempt = 0;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        drop();
        scheduleReconnect();
      }
    });
  }

  return {
    start() {
      stopped = false;
      void open();
    },
    stop() {
      stopped = true;
      generation += 1;
      if (timer !== null) clearTimer(timer);
      timer = null;
      drop();
    },
    /** İnternet geri geldi: kopuksa beklemeden yeniden bağlan. */
    wake() {
      if (stopped || subscribed) return;
      if (timer !== null) clearTimer(timer);
      timer = null;
      attempt = 0;
      void open();
    },
    /** Yalnızca katılmış kanalda gönderilir (supabase-js REST'e düşmesin). */
    send(signal: TypingSignal) {
      if (stopped || !subscribed || !channel) return;
      void channel
        .send({ type: "broadcast", event: TYPING_EVENT, payload: { side: opts.side, state: signal } })
        .catch(() => {});
    },
    get isSubscribed() {
      return subscribed;
    },
  };
}
