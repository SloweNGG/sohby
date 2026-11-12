import type { FriendErrorCode, FriendResult } from "./actions";

/** Arkadaşlık eylemini çalıştıran işlev (düğmeler ortak yardımcıyla kullanır). */
export type FriendActionRunner = () => Promise<FriendResult>;
export type { FriendErrorCode, FriendResult };
