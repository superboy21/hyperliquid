import { describe, expect, spyOn, test } from "bun:test";
import { openPublicBookWs } from "./public";
import type { BookError, BookFrame, BookSocket, BookTarget, BookWsOptions } from "../types";

type Listener<K extends keyof WebSocketEventMap> = (event: WebSocketEventMap[K]) => void;
class FakeSocket implements BookSocket {
  readyState = 1;
  sent: string[] = [];
  private listeners = new Map<string, Set<EventListener>>();
  addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: Listener<K>): void {
    const wrapped: EventListener = event => listener(event as WebSocketEventMap[K]);
    this.wrappers.set(listener as Listener<keyof WebSocketEventMap>, wrapped);
    const set = this.listeners.get(type) ?? new Set<EventListener>(); set.add(wrapped); this.listeners.set(type, set);
  }
  removeEventListener<K extends keyof WebSocketEventMap>(type: K, listener: Listener<K>): void {
    // Keep wrapper identity for cleanup by retaining the original-to-wrapper mapping.
    const wrapper = this.wrappers.get(listener as Listener<keyof WebSocketEventMap>);
    if (wrapper) this.listeners.get(type)?.delete(wrapper);
  }
  private wrappers = new Map<Listener<keyof WebSocketEventMap>, EventListener>();
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.fire("open", new Event("open")); }
  message(value: unknown) { this.fire("message", new MessageEvent("message", { data: JSON.stringify(value) })); }
  fire<K extends keyof WebSocketEventMap>(type: K, event: WebSocketEventMap[K]) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
const target = (exchange: BookTarget["exchange"], more: Partial<BookTarget> = {}): BookTarget => ({ id: "book", exchange, kind: "spot", rawSymbol: "BTC_USDT", baseAsset: "BTC", quoteAsset: "USDT", ...more });
function setup(t: BookTarget, bookMode: "normal" | "rpi" = "normal", getMultiplier?: (target: BookTarget, signal?: AbortSignal) => Promise<number>) {
  const socket = new FakeSocket(), frames: BookFrame[] = [], errors: BookError[] = [], controller = new AbortController();
  const options: BookWsOptions = { bookMode, signal: controller.signal, onFrame: frame => frames.push(frame), onError: error => errors.push(error), socketFactory: () => socket };
  const cleanup = openPublicBookWs(t, options, { getMultiplier });
  return { socket, frames, errors, controller, cleanup };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function waitForSocket(socket: FakeSocket) { for (let i = 0; i < 100 && socket.listenerCount() === 0; i++) await new Promise(resolve => setTimeout(resolve, 1)); }
describe("public order book websocket", () => {
  test("Hyperliquid snapshots filter coin and cleanup removes listeners", () => {
    const h = setup(target("Hyperliquid", { rawSymbol: "dex:BTC" })); h.socket.open();
    expect(JSON.parse(h.socket.sent[0])).toEqual({ method: "subscribe", subscription: { type: "l2Book", coin: "dex:BTC" } });
    h.socket.message({ channel: "l2Book", data: { coin: "wrong", levels: [[], []] } });
    h.socket.message({ channel: "l2Book", data: { coin: "dex:BTC", time: 1700000000, levels: [[{ px: "10", sz: "2" }], [{ px: "11", sz: "3" }]] } });
    expect(h.frames).toHaveLength(1); expect(h.frames[0].book.bids[0]).toEqual({ price: 10, quantity: 2 });
    h.cleanup(); expect(h.socket.listenerCount()).toBe(0);
  });
  test("Lighter colon-channel snapshot, delta deletion and nonce gap", () => {
    const h = setup(target("Lighter", { marketId: 7 })); h.socket.open();
    expect(JSON.parse(h.socket.sent[0])).toEqual({ type: "subscribe", channel: "order_book/7" });
    h.socket.message({ type: "subscribed/order_book", channel: "order_book:7", order_book: { nonce: 10, bids: [{ price: "9", size: "2" }], asks: [{ price: "10", size: "1" }] } });
    h.socket.message({ type: "update/order_book", channel: "order_book:7", timestamp: 1774884082326, order_book: { code: 0, asks: [{ price: "10", size: "0" }], bids: [], nonce: 11, begin_nonce: 10 } });
    expect(h.frames).toHaveLength(2); expect(h.frames[1].book.asks).toEqual([]); expect(h.frames[1].book.bids).toEqual([{ price: 9, quantity: 2 }]);
    h.socket.message({ type: "update/order_book", channel: "order_book:7", order_book: { begin_nonce: 12, nonce: 13, bids: [], asks: [] } });
    expect(h.errors[0]?.code).toBe("sequence-gap"); expect(h.errors).toHaveLength(1); expect(h.socket.listenerCount()).toBe(0);
  });
  test("filters wrong Lighter channels and ignores updates until a snapshot", () => {
    const h = setup(target("Lighter", { marketId: 0 })); h.socket.open();
    const delta = { type: "update/order_book", channel: "order_book:0", order_book: { begin_nonce: 1, nonce: 2, bids: [], asks: [{ price: "2", size: "1" }] } };
    h.socket.message({ ...delta, channel: "order_book:1" }); h.socket.message(delta); expect(h.frames).toHaveLength(0); expect(h.errors).toHaveLength(0);
    h.cleanup();
  });
  test("Gate OBU subscribes to the actual stream and reconstructs full plus deltas with multiplier", async () => {
    const h = setup(target("Gate.io", { kind: "perp", rawSymbol: "BTC_USDT" }), "normal", async () => 0.01); await waitForSocket(h.socket); h.socket.open();
    const subscribe = JSON.parse(h.socket.sent[0]) as { time: number; channel: string; event: string; payload: string[] };
    expect(Number.isFinite(subscribe.time)).toBe(true); expect(subscribe.channel).toBe("futures.obu");
    expect(subscribe.event).toBe("subscribe"); expect(subscribe.payload).toEqual(["ob.BTC_USDT.400"]);
    h.socket.message({ channel: "futures.obu", event: "update", result: { t: 1743673026995, full: true, s: "ob.BTC_USDT.400", u: 79072179673, b: [["83705.9", "30166"]], a: [["83706", "4208"]] } });
    h.socket.message({ channel: "futures.obu", event: "update", result: { t: 1743673027017, s: "ob.BTC_USDT.400", U: 79072179674, u: 79072179694, b: [["83702.2", "62"], ["83702.1", "0"]] } });
    expect(h.frames).toHaveLength(2); expect(h.frames[0].book.bids[0].quantity).toBeCloseTo(301.66);
    expect(h.frames[1].book.asks[0].quantity).toBeCloseTo(42.08); expect(h.frames[1].sequence).toBe("79072179694"); h.cleanup();
  });
  test("Gate RPI perp snapshot keeps RPI route and contract multiplier", async () => {
    const h = setup(target("Gate.io", { kind: "perp", rawSymbol: "BTC_USDT" }), "rpi", async () => 0.1); await waitForSocket(h.socket); h.socket.open();
    expect(JSON.parse(h.socket.sent[0]).channel).toBe("futures.rpi_order_book");
    h.socket.message({ channel: "futures.rpi_order_book", event: "subscribe", result: { status: "success" } });
    h.socket.message({ channel: "futures.rpi_order_book", event: "all", result: { s: "BTC_USDT", id: 42, bids: [{ p: "10", s: "2" }], asks: [{ p: "11", s: "3" }] } });
    expect(h.frames).toHaveLength(1); expect(h.frames[0].book.bids[0].quantity).toBeCloseTo(0.2); expect(h.frames[0].source.route).toBe("futures.rpi_order_book"); h.cleanup();
  });
  test("Gate RPI perp accepts the production contract field and filters a mismatched contract", async () => {
    const h = setup(target("Gate.io", { kind: "perp", rawSymbol: "BTC_USDT" }), "rpi", async () => 0.0001); await waitForSocket(h.socket); h.socket.open();
    h.socket.message({ time: 1792686125, time_ms: 1792686125626, channel: "futures.rpi_order_book", event: "all", result: {
      t: 1792686125626, id: 128698764619, contract: "BTC_USDT",
      asks: [{ p: "81587.3", s: 184824 }, { p: "81587.4", s: 1226 }],
      bids: [{ p: "81587.2", s: 11722 }, { p: "81585.6", s: 6 }], l: "5",
    } });
    h.socket.message({ channel: "futures.rpi_order_book", event: "all", result: { contract: "ETH_USDT", bids: [{ p: "10", s: 1 }], asks: [{ p: "11", s: 1 }] } });
    expect(h.frames).toHaveLength(1); expect(h.frames[0].book.bids[0].quantity).toBeCloseTo(1.1722);
    expect(h.frames[0].source.bookMode).toBe("rpi"); expect(h.frames[0].source.route).toBe("futures.rpi_order_book"); h.cleanup();
  });
  test("rejects empty snapshots and null or blank quantities without false live frames", () => {
    const h = setup(target("Hyperliquid")); h.socket.open();
    h.socket.message({ channel: "l2Book", data: { coin: "BTC_USDT", levels: [[], []] } });
    expect(h.errors[0]?.code).toBe("invalid-payload"); expect(h.frames).toHaveLength(0);
    const bad = setup(target("Hyperliquid")); bad.socket.open();
    bad.socket.message({ channel: "l2Book", data: { coin: "BTC_USDT", levels: [[{ px: "1", sz: null }], []] } });
    expect(bad.errors[0]?.code).toBe("invalid-payload"); expect(bad.frames).toHaveLength(0);
  });
  test("heartbeat is independent of book changes and abort ignores late messages", () => {
    const h = setup(target("Hyperliquid")); h.socket.open();
    h.socket.message({ channel: "l2Book", data: { coin: "BTC_USDT", levels: [[{ px: "10", sz: "2" }], [{ px: "11", sz: "1" }]] } });
    h.controller.abort(); h.socket.message({ channel: "l2Book", data: { coin: "BTC_USDT", levels: [[{ px: "10", sz: "2" }], [{ px: "11", sz: "1" }]] } });
    expect(h.socket.readyState).toBe(3); expect(h.frames).toHaveLength(1); expect(h.errors).toHaveLength(0);
  });
  test("venue heartbeat replies refresh the watchdog without emitting frames", () => {
    const timeoutSpy = spyOn(globalThis, "setTimeout");
    const gate = setup(target("Gate.io")); gate.socket.open();
    const beforeGatePong = timeoutSpy.mock.calls.length;
    gate.socket.message({ channel: "spot.pong", time: 1700000000 });
    expect(timeoutSpy.mock.calls.length).toBeGreaterThan(beforeGatePong); expect(gate.frames).toHaveLength(0);
    const hl = setup(target("Hyperliquid")); hl.socket.open();
    const beforeHlPong = timeoutSpy.mock.calls.length;
    hl.socket.message({ channel: "pong" });
    expect(timeoutSpy.mock.calls.length).toBeGreaterThan(beforeHlPong); expect(hl.frames).toHaveLength(0);
    gate.cleanup(); hl.cleanup();
  });
  test("watchdog timeout reports once and removes socket listeners", () => {
    const timeoutSpy = spyOn(globalThis, "setTimeout");
    const h = setup(target("Hyperliquid")); h.socket.open();
    const watchdog = timeoutSpy.mock.calls.findLast(([, delay]) => delay === 45000)?.[0];
    expect(typeof watchdog).toBe("function");
    if (typeof watchdog === "function") Reflect.apply(watchdog, undefined, []);
    expect(h.errors).toHaveLength(1); expect(h.errors[0]?.code).toBe("timeout"); expect(h.socket.listenerCount()).toBe(0);
    h.socket.fire("close", new CloseEvent("close")); expect(h.errors).toHaveLength(1);
  });
});
