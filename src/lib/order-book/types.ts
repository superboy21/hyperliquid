import type { NormalizedOrderBook } from "../order-book-impact";
import type { BookMode } from "../rpi-book";
import type { SpotExchangeName } from "../spot-search";

export type { NormalizedOrderBook, BookMode, SpotExchangeName };

export interface BookTarget {
  id: string;
  exchange: SpotExchangeName;
  kind: "spot" | "perp";
  rawSymbol: string;
  marketId?: number;
  baseAsset: string;
  quoteAsset: string;
  isRealityToken?: boolean;
}

export interface BookSource {
  transport: "rest" | "ws";
  bookMode: BookMode;
  route: string;
}

export interface BookFrame {
  targetId: string;
  book: NormalizedOrderBook;
  quantityUnit: "base";
  baseAsset: string;
  source: BookSource;
  exchangeTimeMs: number | null;
  receivedAtMs: number;
  sequence: string | null;
}

export type BookErrorCode =
  | "unsupported"
  | "unauthorized"
  | "timeout"
  | "network"
  | "invalid-payload"
  | "sequence-gap"
  | "metadata-unavailable"
  | "unsupported-quantity-unit";

export class BookError extends Error {
  constructor(public readonly code: BookErrorCode, message: string) {
    super(message);
    this.name = "BookError";
  }
}

/** The DOM-compatible surface used by adapters; constructors remain injectable. */
export interface BookSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K, listener: (event: WebSocketEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K, listener: (event: WebSocketEventMap[K]) => void,
  ): void;
}

export type BookSocketFactory = (url: string) => BookSocket;

export interface BookWsOptions {
  bookMode: BookMode;
  signal: AbortSignal;
  onFrame: (frame: BookFrame) => void;
  onError: (error: BookError) => void;
  socketFactory?: BookSocketFactory;
}

export type BookWsOpener = (target: BookTarget, options: BookWsOptions) => () => void;
export type BookRestFetcher = (
  target: BookTarget,
  options: { bookMode: BookMode; signal?: AbortSignal },
) => Promise<BookFrame>;

export interface BookAttempt {
  transport: "rest" | "ws";
  bookMode: BookMode;
}

export interface BookNotice {
  id: number;
  code: "fallback" | "unsupported" | "policy";
  reason: BookErrorCode | "reality-token";
  message: string;
  from: BookAttempt | null;
  to: BookAttempt;
}

export type BookSessionStatus = "idle" | "connecting" | "live" | "stale" | "error" | "closed";

export interface BookSessionState {
  requested: BookAttempt;
  attempt: BookAttempt | null;
  frame: BookFrame | null;
  status: BookSessionStatus;
  notices: readonly BookNotice[];
  error: BookError | null;
  /** Local receipt time of the last accepted frame; never updated by an ack. */
  updated: number | null;
}

export interface BookSessionOptions {
  bookMode: BookMode;
  wsMode: boolean;
  signal?: AbortSignal;
}

export interface BookSession {
  getState(): BookSessionState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface ProjectedBookLevel {
  price: number;
  quantity: number;
  cumulativeQuantity: number;
  rank: number;
}

export interface ProjectedBook {
  bids: ProjectedBookLevel[];
  asks: ProjectedBookLevel[];
}
