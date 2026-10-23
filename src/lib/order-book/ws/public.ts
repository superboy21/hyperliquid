import { BookError, type BookFrame, type BookSocket, type BookTarget, type BookWsOptions } from "../types";
import type { NormalizedBookLevel } from "../../order-book-impact";

type Side = Map<number, number>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const number = (value: unknown): number | null => (typeof value === "string" && value.trim() === "") || (typeof value !== "string" && typeof value !== "number") ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value: unknown): number | null => { const n = number(value); return n !== null && n > 0 ? n : null; };
const timestamp = (value: unknown): number | null => { const n = number(value); return n !== null && n > 0 ? (n < 1e12 ? n * 1000 : n) : null; };
const text = (value: unknown): string | null => typeof value === "string" || typeof value === "number" ? String(value) : null;

export function openPublicBookWs(
  target: BookTarget,
  options: BookWsOptions,
  dependencies: { getMultiplier?: (target: BookTarget, signal?: AbortSignal) => Promise<number> } = {},
): () => void {
  let closed = false, failed = false, ready = false;
  let socket: BookSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let multiplier = 1, nonce: number | null = null, gateUpdateId: number | null = null;
  let route: string | null = null;
  const bids: Side = new Map(), asks: Side = new Map();
  const listeners: Array<() => void> = [];
  const clearTimers = () => {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    heartbeatTimer = null; watchdogTimer = null;
  };
  const cleanup = () => {
    if (closed) return;
    closed = true; clearTimers(); options.signal.removeEventListener("abort", cleanup);
    const ws = socket; socket = null;
    if (ws) {
      for (const remove of listeners.splice(0)) remove();
      if (ws.readyState < 2) { try { ws.close(); } catch { /* Socket already unavailable. */ } }
    }
  };
  const error = (e: BookError) => {
    if (closed || failed) return;
    failed = true; options.onError(e); cleanup();
  };
  const activity = () => {
    if (closed) return;
    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => error(new BookError("timeout", "公共订单簿连接长时间无活动，已停止更新。")), 45000);
  };
  const emit = (time: number | null, sequence: string | null) => {
    if (closed || !ready || (!bids.size && !asks.size) || !route) return;
    const sorted = (side: Side, descending: boolean): NormalizedBookLevel[] => [...side].map(([price, quantity]) => ({ price, quantity: quantity * multiplier })).sort((a, b) => descending ? b.price - a.price : a.price - b.price);
    const frame: BookFrame = { targetId: target.id, quantityUnit: "base", baseAsset: target.baseAsset,
      book: { bids: sorted(bids, true), asks: sorted(asks, false) }, source: { transport: "ws", bookMode: options.bookMode, route },
      exchangeTimeMs: time, receivedAtMs: Date.now(), sequence };
    options.onFrame(frame);
  };
  const setSide = (map: Side, rows: unknown, delta = false) => {
    if (!Array.isArray(rows)) throw new Error("订单簿档位格式无效。");
    if (!delta) map.clear();
    for (const row of rows) {
      const pair = Array.isArray(row) ? row : null;
      const entry = object(row);
      const price = positive(pair ? pair[0] : entry?.p ?? entry?.price ?? entry?.px);
      const quantity = number(pair ? pair[1] : entry?.s ?? entry?.size ?? entry?.sz);
      if (price === null || quantity === null || quantity < 0) throw new Error("订单簿价格或数量无效。");
      if (delta && quantity === 0) map.delete(price);
      else if (quantity > 0) map.set(price, quantity);
    }
  };
  const parse = (event: MessageEvent) => {
    if (closed) return;
    if (event.data === "pong") { activity(); return; }
    let msg: JsonObject | null;
    try {
      const decoded: unknown = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (decoded === "pong") { activity(); return; }
      msg = object(decoded);
    }
    catch { error(new BookError("invalid-payload", "收到无法解析的订单簿消息。")); return; }
    if (!msg) { error(new BookError("invalid-payload", "收到无效的订单簿消息。")); return; }
    try {
      if (target.exchange === "Gate.io") {
        if (msg.error) { error(new BookError("network", "Gate.io 订单簿连接返回错误。")); return; }
        const expectedChannel = target.kind === "perp" && options.bookMode === "normal" ? "futures.obu" : route;
        const pongChannel = target.kind === "spot" ? "spot.pong" : "futures.pong";
        if (msg.channel === pongChannel) { activity(); return; }
        if (msg.channel !== expectedChannel) return;
        if (msg.event === "pong" || msg.event === "subscribe") { activity(); return; }
        if (msg.event !== "update" && !(target.kind === "perp" && options.bookMode === "rpi" && msg.event === "all")) return;
        const result = object(msg.result);
        if (!result) throw new Error("Gate.io 订单簿内容无效。");
        const symbol = text(result.s);
        if (target.kind === "perp" && options.bookMode === "rpi") {
          const contract = Object.prototype.hasOwnProperty.call(result, "contract") ? text(result.contract) : symbol;
          if (contract !== target.rawSymbol) return;
        }
        if (target.kind === "perp" && options.bookMode === "normal") {
          if (symbol !== route) return;
          if (result.full === true) {
            setSide(bids, result.b); setSide(asks, result.a);
            const updateId = number(result.u);
            if (updateId === null) throw new Error("Gate.io 全量订单簿序号无效。");
            gateUpdateId = updateId; ready = true;
          } else {
            if (!ready) return;
            const begin = number(result.U), end = number(result.u);
            if (begin === null || end === null || gateUpdateId === null || begin !== gateUpdateId + 1 || end < begin) {
              error(new BookError("sequence-gap", "Gate.io 合约订单簿序号中断，已停止更新。")); return;
            }
            setSide(bids, result.b ?? [], true); setSide(asks, result.a ?? [], true); gateUpdateId = end;
          }
          if (!bids.size && !asks.size) throw new Error("Gate.io 返回空订单簿。");
          activity(); emit(timestamp(result.t), String(gateUpdateId)); return;
        }
        if (target.kind === "spot" && symbol !== target.rawSymbol) return;
        if (target.kind === "perp" && options.bookMode === "rpi" && msg.event !== "all") return;
        setSide(bids, result.bids); setSide(asks, result.asks);
        if (!bids.size && !asks.size) throw new Error("Gate.io 返回空订单簿。");
        ready = true; activity(); emit(timestamp(result.t ?? result.time_ms), text(result.lastUpdateId ?? result.id)); return;
      }
      if (target.exchange === "Hyperliquid") {
        if (msg.channel === "pong") { activity(); return; }
        if (msg.channel !== "l2Book") return;
        const data = object(msg.data);
        if (!data || data.coin !== target.rawSymbol) return;
        if (!Array.isArray(data.levels) || data.levels.length !== 2) throw new Error("Hyperliquid 订单簿内容无效。");
        setSide(bids, data.levels[0]); setSide(asks, data.levels[1]);
        if (!bids.size && !asks.size) throw new Error("Hyperliquid 返回空订单簿。");
        ready = true; activity(); emit(timestamp(data.time), text(data.sequence)); return;
      }
      if (target.exchange === "Lighter") {
        if (msg.type === "ping") { try { socket?.send(JSON.stringify({ type: "pong" })); } catch { error(new BookError("network", "发送心跳失败，订单簿连接已停止。")); return; } activity(); return; }
        if (msg.type === "connected") { activity(); return; }
        const expectedChannel = `order_book:${target.marketId}`;
        if (msg.channel !== expectedChannel) return;
        if (msg.type === "subscribed/order_book") {
          const data = object(msg.order_book ?? msg.data);
          if (!data) throw new Error("Lighter 订单簿快照无效。");
          setSide(bids, data.bids); setSide(asks, data.asks);
          const snapshotNonce = number(data.nonce);
          if (snapshotNonce === null || (!bids.size && !asks.size)) throw new Error("Lighter 订单簿快照为空或序号无效。");
          nonce = snapshotNonce; ready = true; activity(); emit(timestamp(data.timestamp ?? msg.timestamp), String(nonce)); return;
        }
        if (msg.type === "subscribed") { activity(); return; }
        if (msg.type !== "update/order_book" && msg.type !== "order_book") return;
        const data = object(msg.order_book ?? msg.data);
        if (!data) throw new Error("Lighter 订单簿内容无效。");
        if (msg.type === "update/order_book") {
          if (!ready) return;
          const begin = number(data.begin_nonce), end = number(data.nonce);
          if (begin === null || end === null || nonce === null || begin !== nonce || end < begin) { error(new BookError("sequence-gap", "Lighter 合约订单簿序号中断，已停止更新。")); return; }
          setSide(bids, data.bids ?? [], true); setSide(asks, data.asks ?? [], true); nonce = end;
        } else {
          if (ready) return;
          setSide(bids, data.bids); setSide(asks, data.asks);
          nonce = number(data.nonce); ready = nonce !== null;
        }
        activity();
        if (!bids.size && !asks.size) throw new Error("Lighter 返回空订单簿。");
        if (ready) emit(timestamp(data.timestamp ?? msg.timestamp), nonce === null ? null : String(nonce));
      }
    } catch (cause) { error(new BookError("invalid-payload", cause instanceof Error ? cause.message : "收到无效的订单簿数据。")); }
  };
  const connect = (url: string, subscribe: () => void, ping: string, interval: number) => {
    try {
      const ws = (options.socketFactory ?? ((address: string) => new WebSocket(address) as unknown as BookSocket))(url);
      socket = ws;
      const bind = <K extends keyof WebSocketEventMap>(type: K, handler: (event: WebSocketEventMap[K]) => void) => {
        ws.addEventListener(type, handler); listeners.push(() => ws.removeEventListener(type, handler));
      };
      bind("open", () => {
        if (closed) return;
        try { subscribe(); activity(); heartbeatTimer = setInterval(() => { if (!closed) try { ws.send(ping); } catch { error(new BookError("network", "发送心跳失败，订单簿连接已停止。")); } }, interval); }
        catch { error(new BookError("network", "订阅公共订单簿失败。")); }
      });
      bind("message", parse);
      bind("error", () => error(new BookError("network", "公共订单簿连接发生错误。")));
      bind("close", () => { if (!closed) error(new BookError("network", "公共订单簿连接已关闭。")); });
    } catch { error(new BookError("network", "无法连接公共订单簿。")); }
  };
  if (target.exchange === "Gate.io") route = target.kind === "spot"
    ? options.bookMode === "rpi" ? "spot.rpi_order_book" : "spot.order_book"
    : options.bookMode === "rpi" ? "futures.rpi_order_book" : `ob.${target.rawSymbol}.400`;
  else if (target.exchange === "Hyperliquid") route = "l2Book";
  else if (target.exchange === "Lighter" && Number.isInteger(target.marketId)) route = `order_book:${target.marketId}`;
  if (!route || (options.bookMode === "rpi" && target.exchange !== "Gate.io")) {
    error(new BookError("unsupported", "该交易所或市场不支持此订单簿模式。")); return cleanup;
  }
  if (options.signal.aborted) { cleanup(); return cleanup; }
  options.signal.addEventListener("abort", cleanup, { once: true });
  if (target.exchange === "Gate.io") {
    const url = target.kind === "spot" ? "wss://api.gateio.ws/ws/v4/" : "wss://fx-ws.gateio.ws/v4/ws/usdt";
    const prepare = async () => {
      if (target.kind === "perp") {
        try {
          if (dependencies.getMultiplier) multiplier = await dependencies.getMultiplier(target, options.signal);
          else { const metadata = await import("../metadata"); multiplier = await metadata.getBookQuantityMultiplier(target, options.signal); }
        }
        catch (cause) { if (!closed) error(cause instanceof BookError ? cause : new BookError("metadata-unavailable", "获取合约数量换算信息失败。")); return; }
      }
      if (closed) return;
      const stream = route;
      connect(url, () => socket?.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: target.kind === "perp" && options.bookMode === "normal" ? "futures.obu" : stream, event: "subscribe", payload: target.kind === "perp" && options.bookMode === "normal" ? [stream] : [target.rawSymbol, "5", target.kind === "spot" ? "100ms" : "0"] })), JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: target.kind === "spot" ? "spot.ping" : "futures.ping" }), 15000);
    };
    void prepare();
  } else if (target.exchange === "Hyperliquid") {
    connect("wss://api.hyperliquid.xyz/ws", () => socket?.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: target.rawSymbol } })), JSON.stringify({ method: "ping" }), 30000);
  } else {
    const channel = `order_book/${target.marketId}`;
    connect("wss://mainnet.zklighter.elliot.ai/stream?readonly=true", () => socket?.send(JSON.stringify({ type: "subscribe", channel })), JSON.stringify({ type: "ping" }), 30000);
  }
  return cleanup;
}
