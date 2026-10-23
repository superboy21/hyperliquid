import { BookError } from "../types";
import type { BookErrorCode, BookFrame, BookSocket, BookTarget, BookWsOptions } from "../types";
import { getBookQuantityMultiplier } from "../metadata";
import { fetchOrderBookRest } from "../rest";

type Side = "bids" | "asks";
type Level = { price: number; quantity: number };
type Venue = "binance" | "bybit" | "okx" | "bitget";
type MessageRecord = Record<string, unknown>;
const OPEN = 1;

function fail(code: BookErrorCode, message: string): BookError { return new BookError(code, message); }
function object(value: unknown): MessageRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as MessageRecord : null;
}
function field(record: MessageRecord | null, key: string): unknown { return record?.[key]; }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function numeric(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function array(value: unknown): unknown[] | null { return Array.isArray(value) ? value : null; }

function config(target: BookTarget, mode: "normal" | "rpi") {
  const symbol = target.rawSymbol;
  switch (target.exchange) {
    case "Binance":
      if (mode === "rpi" && target.kind === "spot") throw fail("unsupported", "Binance spot RPI WS 不受支持");
      if (mode === "rpi") return { url: `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@rpiDepth@500ms`, route: `${symbol.toLowerCase()}@rpiDepth@500ms`, venue: "binance" as const };
      if (target.kind === "spot") return { url: `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth5@100ms`, route: `${symbol.toLowerCase()}@depth5@100ms`, venue: "binance" as const };
      return { url: `wss://fstream.binance.com/public/ws/${symbol.toLowerCase()}@depth5@100ms`, route: `${symbol.toLowerCase()}@depth5@100ms`, venue: "binance" as const };
    case "Bybit":
      if (mode === "rpi") return { url: `wss://stream.bybit.com/v5/public/${target.kind === "spot" ? "spot" : "linear"}`, route: `orderbook.rpi.${symbol}`, venue: "bybit" as const };
      return { url: `wss://stream.bybit.com/v5/public/${target.kind === "spot" ? "spot" : "linear"}`, route: `orderbook.50.${symbol}`, venue: "bybit" as const };
    case "OKX":
      return { url: "wss://ws.okx.com:8443/ws/v5/public", route: mode === "rpi" ? `books-rpi:${symbol}` : `books5:${symbol}`, venue: "okx" as const };
    case "Bitget":
      return { url: "wss://ws.bitget.com/v3/ws/public", route: `${mode === "rpi" ? "rpi-books5" : "books5"}:${symbol}`, venue: "bitget" as const };
    default: throw fail("unsupported", `${target.exchange} 没有 CEX WS 盘口适配器`);
  }
}

export interface CexBookWsDependencies {
  fetchRest?: typeof fetchOrderBookRest;
  getMultiplier?: typeof getBookQuantityMultiplier;
}

export function openCexBookWs(target: BookTarget, options: BookWsOptions, dependencies: CexBookWsDependencies = {}): () => void {
  const fetchRest = dependencies.fetchRest ?? fetchOrderBookRest;
  const getMultiplier = dependencies.getMultiplier ?? getBookQuantityMultiplier;
  let stopped = false;
  let reported = false;
  let socket: BookSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let heartbeatId = 0;
  const removers: Array<() => void> = [];
  const books: Record<Side, Map<number, number>> = { bids: new Map(), asks: new Map() };
  let initialized = false;
  let sequence: string | null = null;
  let multiplier = 1;
  let route = "";
  let venue: Venue | undefined;
  const bufferedRpi: MessageRecord[] = [];
  let previousRpiUpdate: number | null = null;
  let rpiSeedSequence: number | null = null;
  const active = () => !stopped && !controller.signal.aborted;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    if (watchdog !== undefined) clearTimeout(watchdog);
    for (const remove of removers.splice(0)) remove();
    controller.abort();
    try { if (socket && socket.readyState < 2) socket.close(); } catch { /* best effort */ }
  };
  const report = (error: BookError) => {
    if (!active() || reported) return;
    reported = true;
    try { options.onError(error); } finally { cleanup(); }
  };
  const abort = () => cleanup();
  if (options.signal.aborted) { cleanup(); return cleanup; }
  if (target.exchange === "Bitget" && target.kind === "spot" && target.isRealityToken) {
    report(fail("unsupported", "rToken 盘口必须使用 REST"));
    return cleanup;
  }
  options.signal.addEventListener("abort", abort, { once: true });
  removers.push(() => options.signal.removeEventListener("abort", abort));

  function emitBook(bids: unknown[], asks: unknown[], snapshot: boolean, seq: string | null, timestamp: unknown, mode: "normal" | "rpi") {
    if (!active()) return;
    if (snapshot) { books.bids.clear(); books.asks.clear(); }
    for (const [side, rows] of [["bids", bids], ["asks", asks]] as const) {
      for (const entry of rows) {
        const row = array(entry);
        if (!row || row.length < 2 || (mode === "rpi" && venue !== "okx" && venue !== "binance" && row.length < 3)) {
          report(fail("invalid-payload", "无效盘口档位")); return;
        }
        const price = numeric(row[0]);
        const quantity = numeric(row[1]);
        const rpiQuantity = mode === "rpi" && venue !== "okx" && venue !== "binance" ? numeric(row[2]) : 0;
        if (price === null || price <= 0 || quantity === null || quantity < 0 || rpiQuantity === null || rpiQuantity < 0) {
          report(fail("invalid-payload", "盘口价格或数量无效")); return;
        }
        const total = (quantity + rpiQuantity) * multiplier;
        if (!Number.isFinite(total)) { report(fail("invalid-payload", "盘口数量超出有效范围")); return; }
        if (total === 0) books[side].delete(price); else books[side].set(price, total);
      }
    }
    if (snapshot && books.bids.size === 0 && books.asks.size === 0) {
      report(fail("invalid-payload", "盘口快照双侧为空")); return;
    }
    initialized = true;
    if (seq !== null) sequence = seq;
    const levels = (side: Side): Level[] => [...books[side]].map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => side === "bids" ? b.price - a.price : a.price - b.price);
    options.onFrame({ targetId: target.id, book: { bids: levels("bids"), asks: levels("asks") }, quantityUnit: "base",
      baseAsset: target.baseAsset, source: { transport: "ws", bookMode: mode, route },
      exchangeTimeMs: numeric(timestamp), receivedAtMs: Date.now(), sequence } satisfies BookFrame);
  }

  async function seedBinanceRpi() {
    try {
      const seed = await fetchRest(target, { bookMode: "rpi", signal: controller.signal });
      if (!active()) return;
      const last = seed.sequence === null ? null : Number(seed.sequence);
      if (seed.source.transport !== "rest" || seed.source.bookMode !== "rpi" || last === null || !Number.isSafeInteger(last)) {
        report(fail("invalid-payload", "Binance RPI REST seed 缺少有效 lastUpdateId")); return;
      }
      for (const level of seed.book.bids) books.bids.set(level.price, level.quantity);
      for (const level of seed.book.asks) books.asks.set(level.price, level.quantity);
      if (!books.bids.size && !books.asks.size) { report(fail("invalid-payload", "Binance RPI REST seed 为空")); return; }
      sequence = String(last);
      rpiSeedSequence = last;
      const pending = bufferedRpi.splice(0);
      for (let index = 0; index < pending.length; index++) {
        const update = pending[index];
        const updateLast = numeric(field(update, "u"));
        if (previousRpiUpdate === null && updateLast !== null && updateLast <= last) continue;
        if (applyRpiUpdate(update, last)) {
          for (const next of pending.slice(index + 1)) {
            if (!active()) return;
            applyRpiUpdate(next, last);
          }
          return;
        }
        if (!active()) return;
      }
    } catch (error) {
      if (!active()) return;
      report(error instanceof BookError ? error : fail("network", error instanceof Error ? error.message : "Binance RPI seed 请求失败"));
    }
  }

  function applyRpiUpdate(update: MessageRecord, seedSequence: number): boolean {
    const sequenceNumber = (value: unknown) => {
      const parsed = numeric(value);
      return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    const first = sequenceNumber(field(update, "U"));
    const last = sequenceNumber(field(update, "u"));
    const previous = sequenceNumber(field(update, "pu"));
    const bids = array(field(update, "b")); const asks = array(field(update, "a"));
    if (first === null || last === null || previous === null || first > last || !bids || !asks) {
      report(fail("invalid-payload", "Binance RPI depth update 格式无效")); return false;
    }
    if (previousRpiUpdate === null) {
      if (last <= seedSequence || !(first <= seedSequence + 1 && seedSequence + 1 <= last)) return false;
    } else {
      if (last <= previousRpiUpdate) return false;
      if (previous !== previousRpiUpdate) { report(fail("sequence-gap", "Binance RPI pu 不连续")); return false; }
    }
    emitBook(bids, asks, false, String(last), field(update, "E"), "rpi");
    if (!active() || !initialized) return false;
    previousRpiUpdate = last;
    return true;
  }

  void (async () => {
    try {
      const mode = options.bookMode;
      const cfg = config(target, mode);
      route = cfg.route;
      venue = cfg.venue;
      if (target.exchange === "OKX" && target.kind === "perp") {
        try { multiplier = await getMultiplier(target, controller.signal); }
        catch (error) {
          if (error instanceof BookError) throw error;
          throw fail("metadata-unavailable", error instanceof Error ? error.message : "OKX 数量单位 metadata 不可用");
        }
      }
      if (!active()) return;
      const factory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as BookSocket);
      socket = factory(cfg.url);
      const listen = <K extends keyof WebSocketEventMap>(type: K, handler: (event: WebSocketEventMap[K]) => void) => {
        socket?.addEventListener(type, handler);
        removers.push(() => socket?.removeEventListener(type, handler));
      };
      listen("open", () => {
        if (!active() || !socket) return;
        if (venue === "bybit") socket.send(JSON.stringify({ op: "subscribe", args: [route] }));
        if (venue === "okx") socket.send(JSON.stringify({ op: "subscribe", args: [{ channel: mode === "rpi" ? "books-rpi" : "books5", instId: target.rawSymbol }] }));
        if (venue === "bitget") socket.send(JSON.stringify({ op: "subscribe", args: [{ instType: target.kind === "spot" ? "spot" : "usdt-futures", topic: mode === "rpi" ? "rpi-books5" : "books5", symbol: target.rawSymbol }] }));
        if (venue === "binance" && mode === "rpi") void seedBinanceRpi();
        const intervalMs = venue === "bybit" ? 20_000 : 30_000;
        heartbeat = setInterval(() => {
          if (!active() || socket?.readyState !== OPEN) return;
          try {
            const ping = venue === "bybit" ? JSON.stringify({ op: "ping" })
              : venue === "binance" ? JSON.stringify({ method: "LIST_SUBSCRIPTIONS", id: ++heartbeatId }) : "ping";
            socket.send(ping);
            if (watchdog === undefined) watchdog = setTimeout(() => report(fail("timeout", `${target.exchange} WS 心跳超时`)), 10_000);
          } catch { report(fail("network", `${target.exchange} WS 心跳发送失败`)); }
        }, intervalMs);
      });
      listen("error", () => report(fail("network", `${target.exchange} WS 网络错误`)));
      listen("close", (event) => report(fail("network", `${target.exchange} WS 已关闭${event.reason ? `: ${event.reason}` : ""}`)));
      listen("message", (event) => {
        if (!active()) return;
        if (watchdog !== undefined) { clearTimeout(watchdog); watchdog = undefined; }
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        if (raw === "pong" || raw === "ping") return;
        let parsed: unknown;
        try { parsed = JSON.parse(raw) as unknown; }
        catch { report(fail("invalid-payload", "WS 消息不是有效 JSON")); return; }
        const msg = object(parsed);
        if (!msg) return;
        if (field(msg, "op") === "pong" || field(msg, "event") === "subscribe" || field(msg, "event") === "login" || field(msg, "event") === "unsubscribe") return;
        if (field(msg, "event") === "error" || (venue === "bybit" && field(msg, "success") === false) || (venue === "bitget" && field(msg, "event") === "error")) {
          report(fail("unauthorized", String(field(msg, "msg") ?? field(msg, "ret_msg") ?? field(msg, "code") ?? "订阅被拒绝"))); return;
        }
        if (venue === "binance") {
          if (mode === "rpi") {
            if (field(msg, "e") !== "depthUpdate") return;
            const rpiSymbol = string(field(msg, "s"));
            if (rpiSymbol !== null && rpiSymbol !== target.rawSymbol) return;
            if (bufferedRpi.length >= 2_000) { report(fail("sequence-gap", "Binance RPI seed 等待期间更新缓冲区溢出")); return; }
            if (rpiSeedSequence === null) bufferedRpi.push(msg);
            else applyRpiUpdate(msg, rpiSeedSequence);
            return;
          }
          const symbol = string(field(msg, "s"));
          if (symbol !== null && symbol !== target.rawSymbol) return;
          const bids = array(field(msg, target.kind === "perp" ? "b" : "bids"));
          const asks = array(field(msg, target.kind === "perp" ? "a" : "asks"));
          if (!bids || !asks) return;
          emitBook(bids, asks, true, null, field(msg, "E"), "normal"); return;
        }
        let data: MessageRecord | null;
        let bids: unknown[] | null;
        let asks: unknown[] | null;
        let snapshot = false;
        let seq: string | null = null;
        let timestamp: unknown = null;
        if (venue === "bybit") {
          const topic = string(field(msg, "topic"));
          if (topic !== route) return;
          const messageType = field(msg, "type");
          if (messageType !== "snapshot" && messageType !== "delta") { report(fail("invalid-payload", "Bybit 盘口消息类型无效")); return; }
          data = object(field(msg, "data"));
          if (!data) return;
          const symbol = string(field(data, "s"));
          if (symbol !== null && symbol !== target.rawSymbol) return;
          snapshot = messageType === "snapshot" || numeric(field(data, "u")) === 1;
          if (!snapshot && !initialized) return;
          bids = array(field(data, "b")); asks = array(field(data, "a"));
          seq = field(data, "seq") == null ? null : String(field(data, "seq")); timestamp = field(msg, "ts");
        } else if (venue === "okx") {
          const arg = object(field(msg, "arg"));
          if (field(arg, "channel") !== (mode === "rpi" ? "books-rpi" : "books5") || field(arg, "instId") !== target.rawSymbol) return;
          const action = field(msg, "action");
          const missingNormalBooks5Action = mode === "normal" && field(arg, "channel") === "books5" && action === undefined;
          if (!missingNormalBooks5Action && action !== "snapshot" && action !== "update") {
            report(fail("invalid-payload", "OKX 盘口 action 无效")); return;
          }
          const rows = array(field(msg, "data")); data = object(rows?.[0]);
          if (!data) return;
          snapshot = missingNormalBooks5Action || action === "snapshot";
          if (!snapshot && !initialized) return;
          bids = array(field(data, "bids")); asks = array(field(data, "asks"));
          seq = field(data, "seqId") == null ? null : String(field(data, "seqId")); timestamp = field(data, "ts");
          if (initialized && !snapshot && String(field(data, "prevSeqId")) !== sequence) {
            report(fail("sequence-gap", "OKX order book sequence gap")); return;
          }
        } else {
          const arg = object(field(msg, "arg"));
          if (field(arg, "topic") !== (mode === "rpi" ? "rpi-books5" : "books5")
            || field(arg, "symbol") !== target.rawSymbol
            || field(arg, "instType") !== (target.kind === "spot" ? "spot" : "usdt-futures")) return;
          const rows = array(field(msg, "data")); data = object(rows?.[0] ?? field(msg, "data"));
          if (!data) return;
          bids = array(field(data, "b")); asks = array(field(data, "a")); snapshot = true; timestamp = field(data, "ts");
        }
        if (!bids || !asks) { report(fail("invalid-payload", "盘口数据缺少 bids/asks")); return; }
        emitBook(bids, asks, snapshot, seq, timestamp, mode);
      });
    } catch (error) {
      report(error instanceof BookError ? error : fail("network", error instanceof Error ? error.message : "WS 初始化失败"));
    }
  })();
  return cleanup;
}
