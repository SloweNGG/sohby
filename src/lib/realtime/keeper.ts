/**
 * Realtime kanal yöneticisi (React'ten bağımsız; Node ile test edilir).
 *
 * Neden var: supabase-js `channel(ad)` aynı adlı bir kanal zaten varsa YENİSİNİ
 * AÇMAZ, eskisini döndürür. `removeChannel` ise sunucudan "ayrıldın" yanıtını
 * bekler; o sırada kanal listede "ayrılıyor" durumunda kalır. Bileşen hızla
 * yeniden kurulunca (React geliştirme modunun çift çalıştırması, sayfa geçişi)
 * yeni abonelik ölmek üzere olan kanala bağlanıyor, `subscribe()` kapalı
 * olmayan kanalda hiçbir şey yapmıyor ve kanal az sonra siliniyordu → sayfa
 * sessizce hiç mesaj almıyordu. Ayrıca kopukluktan sonra araya düşen mesajlar
 * hiç tamamlanmıyordu.
 *
 * Çözüm:
 *  - Her açılışta BENZERSİZ kanal adı (eski kanalla asla çakışmaz).
 *  - Durumlar (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED) bildirilir.
 *  - Hata / zaman aşımı / kapanmada kanal kaldırılıp artan beklemeyle
 *    (1 sn, 2 sn, 4 sn … en çok 30 sn) yeniden abone olunur.
 *  - Her SUBSCRIBED'da (ilk açılış dahil) `onResync` çağrılır: çağıran,
 *    kaçırılmış olabilecek kayıtları veritabanından tamamlar.
 *  - Abone olmadan önce `beforeSubscribe` (yetki tazeleme) beklenir.
 */

export type RealtimeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
export type ResyncReason = "subscribed" | "visible" | "online";

export type Binding = {
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  table: string;
  schema?: string;
  filter?: string;
};

export type ChannelLike = {
  on(type: "postgres_changes", filter: Record<string, unknown>, callback: (payload: { new: Record<string, unknown> }) => void): ChannelLike;
  subscribe(callback: (status: string, err?: Error) => void): ChannelLike;
};

export type ClientLike = {
  channel(topic: string): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
};

export type KeeperOptions = {
  client: ClientLike;
  /** Kanal adının sabit kısmı (benzersiz son ek otomatik eklenir). */
  name: string;
  bindings: Binding[];
  onEvent: (payload: { new: Record<string, unknown> }, binding: Binding) => void;
  onResync?: (reason: ResyncReason) => void;
  onStatus?: (status: RealtimeStatus, err?: Error) => void;
  /** Abone olmadan önce (ör. Realtime yetkisini tazelemek için). */
  beforeSubscribe?: () => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  uniqueSuffix?: () => string;
};

export const MAX_BACKOFF_MS = 30_000;

/** n'inci yeniden denemenin beklemesi: 1, 2, 4, 8, 16, 30, 30 … saniye. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1));
}

export function createChannelKeeper(opts: KeeperOptions) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const suffix = opts.uniqueSuffix ?? (() => Math.random().toString(36).slice(2, 10));

  let channel: ChannelLike | null = null;
  let generation = 0;
  let attempt = 0;
  let subscribed = false;
  let stopped = false;
  let timer: unknown = null;

  const drop = () => {
    const old = channel;
    channel = null;
    subscribed = false;
    if (old) void opts.client.removeChannel(old).catch(() => {});
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
    try {
      await opts.beforeSubscribe?.();
    } catch {
      /* yetki tazelenemezse yine de denenir; hata durumunda yeniden denenecek */
    }
    if (stopped || gen !== generation) return;
    let ch = opts.client.channel(`${opts.name}:${suffix()}`);
    for (const b of opts.bindings) {
      ch = ch.on(
        "postgres_changes",
        { event: b.event, schema: b.schema ?? "public", table: b.table, ...(b.filter ? { filter: b.filter } : {}) },
        (payload) => {
          if (gen === generation && !stopped) opts.onEvent(payload, b);
        },
      );
    }
    channel = ch;
    ch.subscribe((raw, err) => {
      // Eski (değiştirilmiş ya da kapatılmış) kanaldan gelen durumlar yok sayılır.
      if (stopped || gen !== generation) return;
      const status = raw as RealtimeStatus;
      opts.onStatus?.(status, err);
      if (status === "SUBSCRIBED") {
        subscribed = true;
        attempt = 0;
        opts.onResync?.("subscribed");
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
    /** Sekme görünür oldu / internet geri geldi: eksikleri tamamla, kopuksa hemen bağlan. */
    wake(reason: Exclude<ResyncReason, "subscribed">) {
      if (stopped) return;
      if (subscribed) {
        opts.onResync?.(reason);
        return;
      }
      if (timer !== null) clearTimer(timer);
      timer = null;
      attempt = 0;
      void open(); // SUBSCRIBED olunca onResync zaten çağrılır.
    },
    get isSubscribed() {
      return subscribed;
    },
  };
}
