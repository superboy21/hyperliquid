import { describe, expect, test } from "bun:test";
let holdMetadataRequest = false;
let metadataRequestSignal: AbortSignal | undefined;
let completeMetadataRequest: (() => void) | undefined;
const fakeMultiplier = async (_target: BookTarget, signal?: AbortSignal): Promise<number> => {
  metadataRequestSignal = signal;
  if (!holdMetadataRequest) return Promise.resolve(0.01);
  return new Promise<number>((resolve) => { completeMetadataRequest = () => resolve(0.01); });
};
let holdSeedRequest = false;
let seedRequestCount = 0;
let seedRequestSignal: AbortSignal | undefined;
let completeSeedRequest: (() => void) | undefined;
const seedFrame: BookFrame = {
  targetId: "market-1", book: { bids: [{ price: 100, quantity: 2 }], asks: [{ price: 101, quantity: 3 }] },
  quantityUnit: "base", baseAsset: "BTC", source: { transport: "rest", bookMode: "rpi", route: "/fapi/v1/rpiDepth" },
  exchangeTimeMs: null, receivedAtMs: 1, sequence: "100",
};
const fakeRest: typeof import("../rest").fetchOrderBookRest = (_target, { signal }) => {
  seedRequestCount++;
  seedRequestSignal = signal;
  if (!holdSeedRequest) return Promise.resolve(seedFrame);
  return new Promise<BookFrame>((resolve) => { completeSeedRequest = () => resolve(seedFrame); });
};
import { openCexBookWs } from "./cex";
import type { BookError, BookFrame, BookSocket, BookTarget } from "../types";

class FakeSocket implements BookSocket {
  readyState = 0;
  sent: string[] = [];
  handlers = new Map<string, Set<(event: unknown) => void>>();
  addEventListener<K extends keyof WebSocketEventMap>(type: K, fn: (event: WebSocketEventMap[K]) => void) {
    const set = this.handlers.get(type) ?? new Set<(event: unknown) => void>();
    set.add(fn as (event: unknown) => void); this.handlers.set(type, set);
  }
  removeEventListener<K extends keyof WebSocketEventMap>(type: K, fn: (event: WebSocketEventMap[K]) => void) {
    this.handlers.get(type)?.delete(fn as (event: unknown) => void);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit("close", { reason: "" }); }
  emit(type: string, event: unknown = {}) { for (const fn of this.handlers.get(type) ?? []) fn(event); }
  open() { this.readyState = 1; this.emit("open"); }
  message(value: unknown) { this.emit("message", { data: typeof value === "string" ? value : JSON.stringify(value) }); }
}

const target = (exchange: BookTarget["exchange"], kind: BookTarget["kind"] = "spot"): BookTarget => ({
  id: "market-1", exchange, kind, rawSymbol: exchange === "OKX" ? "BTC-USDT-SWAP" : "BTCUSDT",
  baseAsset: "BTC", quoteAsset: "USDT",
});

function connect(t: BookTarget, mode: "normal" | "rpi" = "normal") {
  const socket = new FakeSocket(); const frames: BookFrame[] = []; const errors: BookError[] = [];
  let url = "";
  const controller = new AbortController();
  const close = openCexBookWs(t, { bookMode: mode, signal: controller.signal, onFrame: (f) => frames.push(f), onError: (e) => errors.push(e), socketFactory: (socketUrl) => { url = socketUrl; return socket; } }, {
    fetchRest: fakeRest, getMultiplier: fakeMultiplier,
  });
  return { socket, frames, errors, controller, close, get url() { return url; } };
}

describe("CEX WS adapters", () => {
  test("Binance spot normal consumes only actual snapshot payload", async () => {
    const c = connect(target("Binance")); await Promise.resolve(); c.socket.open();
    c.socket.message({ result: null, id: 1 });
    c.socket.message({ bids: [["100", "2"]], asks: [["101", "3"]], E: 123 });
    expect(c.frames).toHaveLength(1); expect(c.frames[0].book.bids[0]).toEqual({ price: 100, quantity: 2 });
    expect(c.frames[0].source.route).toContain("@depth5@100ms"); c.close();
  });

  test("Binance USD-M uses b/a snapshot fields", async () => {
    const c = connect(target("Binance", "perp")); await Promise.resolve(); c.socket.open();
    c.socket.message({ b: [["100", "2"]], a: [["101", "3"]], E: 124 });
    expect(c.frames).toHaveLength(1); expect(c.frames[0].book.asks[0].quantity).toBe(3); c.close();
  });

  test("Binance RPI buffers through REST seed, bridges U/u, and applies zero deletion", async () => {
    const c = connect(target("Binance", "perp"), "rpi"); await Promise.resolve(); c.socket.open();
    c.socket.message({ e: "depthUpdate", E: 200, s: "BTCUSDT", U: 99, u: 105, pu: 98, b: [["99", "4"]], a: [] });
    await Promise.resolve(); await Promise.resolve();
    expect(c.frames).toHaveLength(1);
    expect(c.frames[0].source.transport).toBe("ws"); expect(c.frames[0].sequence).toBe("105");
    expect(c.frames[0].book.bids.map((level) => level.price)).toEqual([100, 99]);
    c.socket.message({ e: "depthUpdate", E: 201, s: "BTCUSDT", U: 106, u: 106, pu: 105, b: [["100", "0"]], a: [] });
    expect(c.frames[1].book.bids.map((level) => level.price)).toEqual([99]);
    c.close();
  });

  test("Binance RPI rejects pu gaps after the initial bridge", async () => {
    const c = connect(target("Binance", "perp"), "rpi"); await Promise.resolve(); c.socket.open();
    c.socket.message({ e: "depthUpdate", E: 200, U: 99, u: 105, pu: 98, b: [["99", "4"]], a: [] });
    await Promise.resolve(); await Promise.resolve();
    c.socket.message({ e: "depthUpdate", E: 201, U: 106, u: 107, pu: 104, b: [], a: [] });
    expect(c.errors[0]?.code).toBe("sequence-gap"); c.close();
  });

  test("cleanup aborts an in-flight Binance REST seed request", async () => {
    holdSeedRequest = true;
    try {
      seedRequestSignal = undefined;
      seedRequestCount = 0;
      const c = connect(target("Binance", "perp"), "rpi");
      for (let attempt = 0; attempt < 5 && !c.socket.handlers.has("open"); attempt++) await Promise.resolve();
      c.socket.open();
      await Promise.resolve(); await Promise.resolve();
      expect(seedRequestCount).toBe(1);
      expect(seedRequestSignal?.aborted).toBe(false);
      c.close();
      expect(seedRequestSignal?.aborted).toBe(true);
      completeSeedRequest?.(); await Promise.resolve();
      expect(c.frames).toHaveLength(0); expect(c.errors).toHaveLength(0);
    } finally {
      holdSeedRequest = false; completeSeedRequest = undefined;
    }
  });

  test("cleanup aborts an in-flight OKX metadata request", async () => {
    holdMetadataRequest = true;
    try {
      metadataRequestSignal = undefined;
      const c = connect(target("OKX", "perp"));
      for (let attempt = 0; attempt < 5 && !metadataRequestSignal; attempt++) await Promise.resolve();
      expect(metadataRequestSignal?.aborted).toBe(false);
      c.close();
      expect(metadataRequestSignal?.aborted).toBe(true);
      completeMetadataRequest?.(); await Promise.resolve();
      expect(c.errors).toHaveLength(0); expect(c.frames).toHaveLength(0);
    } finally {
      holdMetadataRequest = false; completeMetadataRequest = undefined;
    }
  });

  test("OKX normal snapshot followed by a sequence gap fails closed", async () => {
    const c = connect(target("OKX")); await Promise.resolve(); c.socket.open();
    c.socket.message({ event: "subscribe" });
    c.socket.message({ arg: { channel: "books5", instId: "BTC-USDT-SWAP" }, action: "snapshot", data: [{ seqId: 10, bids: [["100", "2", "2", "1"]], asks: [["101", "3", "3", "1"]] }] });
    c.socket.message({ arg: { channel: "books5", instId: "BTC-USDT-SWAP" }, action: "update", data: [{ seqId: 12, prevSeqId: 8, bids: [], asks: [] }] });
    expect(c.frames).toHaveLength(1); expect(c.errors[0]?.code).toBe("sequence-gap"); c.close();
  });

  test("OKX normal books5 without action treats every message as a replacement snapshot", async () => {
    for (const kind of ["spot", "perp"] as const) {
      const t = target("OKX", kind);
      const c = connect(t);
      for (let attempt = 0; attempt < 5 && !c.socket.handlers.has("open"); attempt++) await Promise.resolve();
      c.socket.open();
      const channel = "books5";
      const instId = t.rawSymbol;
      c.socket.message({ arg: { channel, instId }, data: [{ instId, seqId: 1, ts: "1000", bids: [["100", "2", "0", "1"], ["99", "3", "0", "1"]], asks: [["101", "4", "0", "1"]] }] });
      c.socket.message({ arg: { channel, instId }, data: [{ instId, seqId: 2, ts: "1001", bids: [["102", "5", "0", "1"]], asks: [["103", "6", "0", "1"]] }] });
      expect(c.frames).toHaveLength(2);
      expect(c.frames[1].book.bids.map((level) => level.price)).toEqual([102]);
      expect(c.frames[1].book.asks.map((level) => level.price)).toEqual([103]);
      c.close();
    }
  });

  test("OKX RPI still requires explicit snapshot/update action", async () => {
    const c = connect(target("OKX"), "rpi");
    for (let attempt = 0; attempt < 5 && !c.socket.handlers.has("open"); attempt++) await Promise.resolve();
    c.socket.open();
    c.socket.message({ arg: { channel: "books-rpi", instId: "BTC-USDT-SWAP" }, data: [{ seqId: 1, bids: [["100", "2", "1", "1"]], asks: [["101", "2", "1", "1"]] }] });
    expect(c.errors[0]?.code).toBe("invalid-payload"); expect(c.frames).toHaveLength(0);
    c.close();
  });

  test("OKX perp metadata converts contract quantity to base quantity", async () => {
    const c = connect(target("OKX", "perp"));
    for (let attempt = 0; attempt < 5 && !c.socket.handlers.has("open"); attempt++) await Promise.resolve();
    c.socket.open();
    c.socket.message({ arg: { channel: "books5", instId: "BTC-USDT-SWAP" }, action: "snapshot", data: [{ seqId: 1, bids: [["100", "2", "2", "1"]], asks: [["101", "3", "3", "1"]] }] });
    expect(c.frames[0]?.book.bids[0]?.quantity).toBe(0.02); c.close();
  });

  test("plain pong is activity and an OKX first update is not a snapshot", async () => {
    const c = connect(target("OKX")); await Promise.resolve(); c.socket.open();
    c.socket.message("pong");
    c.socket.message({ arg: { channel: "books5", instId: "BTC-USDT-SWAP" }, action: "update", data: [{ seqId: 2, prevSeqId: 1, bids: [["100", "2"]], asks: [] }] });
    expect(c.errors).toHaveLength(0); expect(c.frames).toHaveLength(0); c.close();
  });

  test("Bybit first delta is ignored until a valid snapshot", async () => {
    const c = connect(target("Bybit")); await Promise.resolve(); c.socket.open();
    c.socket.message({ topic: "orderbook.50.BTCUSDT", type: "delta", data: { u: 2, b: [["100", "2"]], a: [] } });
    expect(c.frames).toHaveLength(0);
    c.socket.message({ topic: "orderbook.50.BTCUSDT", type: "snapshot", data: { u: 3, b: [["100", "2"]], a: [] } });
    expect(c.frames).toHaveLength(1); c.close();
  });

  test("RPI two-column rows and empty snapshots fail closed", async () => {
    const c = connect(target("Bitget"), "rpi"); await Promise.resolve(); c.socket.open();
    c.socket.message({ arg: { topic: "rpi-books5", instType: "spot", symbol: "BTCUSDT" }, data: [{ b: [["100", "2"]], a: [] }] });
    expect(c.errors[0]?.code).toBe("invalid-payload"); expect(c.frames).toHaveLength(0);
    const empty = connect(target("Binance")); await Promise.resolve(); empty.socket.open();
    empty.socket.message({ bids: [], asks: [] });
    expect(empty.errors[0]?.code).toBe("invalid-payload"); empty.close();
  });

  test.each([false, " "])("rejects malformed quantity %j instead of treating it as zero", async (quantity) => {
    const c = connect(target("Binance")); await Promise.resolve(); c.socket.open();
    c.socket.message({ bids: [["100", quantity]], asks: [["101", "1"]] });
    expect(c.frames).toHaveLength(0);
    expect(c.errors[0]?.code).toBe("invalid-payload");
    c.close();
  });

  test("text pong is not parsed as JSON", async () => {
    const c = connect(target("Bitget")); await Promise.resolve(); c.socket.open();
    c.socket.message("pong"); expect(c.errors).toHaveLength(0); c.close();
  });

  test("Binance LIST_SUBSCRIPTIONS heartbeat times out after its deadline exactly once", async () => {
    const savedInterval = globalThis.setInterval;
    const savedTimeout = globalThis.setTimeout;
    let pulse: (() => void) | undefined;
    let deadline: (() => void) | undefined;
    Object.defineProperty(globalThis, "setInterval", { configurable: true, value: (fn: () => void) => { pulse = fn; return 1; } });
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (fn: () => void) => { deadline = fn; return 2; } });
    try {
      const c = connect(target("Binance")); await Promise.resolve(); c.socket.open();
      pulse?.();
      expect(JSON.parse(c.socket.sent[0])).toEqual({ method: "LIST_SUBSCRIPTIONS", id: 1 });
      expect(c.errors).toHaveLength(0);
      deadline?.(); deadline?.();
      expect(c.errors).toHaveLength(1); expect(c.errors[0]?.code).toBe("timeout"); expect(c.socket.readyState).toBe(3);
    } finally {
      Object.defineProperty(globalThis, "setInterval", { configurable: true, value: savedInterval });
      Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: savedTimeout });
    }
  });

  test("abort while OKX metadata is pending suppresses callbacks", async () => {
    const c = connect(target("OKX", "perp")); c.controller.abort();
    await Promise.resolve(); await Promise.resolve();
    expect(c.errors).toHaveLength(0); expect(c.frames).toHaveLength(0);
  });

  test("Bybit normal applies absolute delta deletes", async () => {
    const c = connect(target("Bybit")); await Promise.resolve(); c.socket.open();
    c.socket.message({ success: true });
    c.socket.message({ topic: "orderbook.50.BTCUSDT", type: "snapshot", ts: 5, data: { u: 1, seq: 8, b: [["100", "5"]], a: [["101", "1"]] } });
    expect(c.frames[0].book.bids[0].quantity).toBe(5);
    c.socket.message({ topic: "orderbook.50.BTCUSDT", type: "delta", ts: 6, data: { u: 2, seq: 9, b: [["100", "0"]], a: [] } });
    expect(c.frames[1].book.bids).toEqual([]); c.close();
  });

  test("Bybit RPI uses categorized spot/linear endpoints and RPI topic", async () => {
    const spot = connect(target("Bybit", "spot"), "rpi"); const linear = connect(target("Bybit", "perp"), "rpi");
    await Promise.resolve(); await Promise.resolve();
    expect(spot.url).toBe("wss://stream.bybit.com/v5/public/spot");
    expect(linear.url).toBe("wss://stream.bybit.com/v5/public/linear");
    spot.socket.open(); linear.socket.open();
    expect(JSON.parse(spot.socket.sent[0]).args[0]).toBe("orderbook.rpi.BTCUSDT");
    expect(JSON.parse(linear.socket.sent[0]).args[0]).toBe("orderbook.rpi.BTCUSDT");
    spot.socket.message({ topic: "orderbook.rpi.BTCUSDT", type: "snapshot", data: { u: 1, b: [["100", "2", "3"]], a: [["101", "1", "2"]] } });
    expect(spot.frames[0]?.book.bids[0]?.quantity).toBe(5);
    spot.close(); linear.close();
  });

  test("Bitget RPI total uses two amounts once and rejects wrong target", async () => {
    const c = connect(target("Bitget"), "rpi"); await Promise.resolve(); c.socket.open();
    c.socket.message({ arg: { topic: "rpi-books5", instType: "spot", symbol: "OTHER" }, data: [{ b: [["1", "9", "7"]], a: [] }] });
    c.socket.message({ arg: { topic: "rpi-books5", instType: "spot", symbol: "BTCUSDT" }, data: [{ b: [["100", "2", "3"]], a: [["101", "1", "2"]] }] });
    expect(c.frames).toHaveLength(1); expect(c.frames[0].book.bids[0].quantity).toBe(5); c.close();
  });

  test("protocol error is reported once and cleanup prevents later output", async () => {
    const c = connect(target("Bybit")); await Promise.resolve(); c.socket.open();
    c.socket.message({ success: false, ret_msg: "denied" });
    c.socket.message({ topic: "orderbook.50.BTCUSDT", type: "snapshot", data: { b: [["1", "2"]], a: [] } });
    expect(c.errors).toHaveLength(1); expect(c.errors[0].code).toBe("unauthorized"); expect(c.frames).toHaveLength(0);
  });

  test("Binance RPI uses the verified stream and abort suppresses events", async () => {
    const rpi = connect(target("Binance", "perp"), "rpi"); await Promise.resolve();
    expect(rpi.url).toContain("/ws/btcusdt@rpiDepth@500ms");
    rpi.close();
    const c = connect(target("Binance")); await Promise.resolve(); c.controller.abort(); c.socket.open();
    c.socket.message({ bids: [["1", "2"]], asks: [] }); expect(c.frames).toHaveLength(0);
  });
});
