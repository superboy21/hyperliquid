import type { BookAttempt, BookNotice, BookSessionOptions, BookTarget } from "./types";

export interface BookCapabilities {
  rest: { normal: boolean; rpi: boolean };
  ws: { normal: boolean; rpi: boolean };
}

export function getBookCapabilities(target: BookTarget): BookCapabilities {
  const reality = target.kind === "spot" && target.exchange === "Bitget" && target.isRealityToken === true;
  const rpi = !reality && target.exchange !== "Hyperliquid" && target.exchange !== "Lighter"
    && !(target.exchange === "Binance" && target.kind === "spot");
  return { rest: { normal: true, rpi }, ws: { normal: !reality, rpi } };
}

export interface BookAttemptPlan {
  attempts: BookAttempt[];
  notices: Omit<BookNotice, "id">[];
}

/** Plan ordered transport/mode candidates without repeating the requested REST attempt. */
export function createBookAttemptPlan(
  target: BookTarget,
  options: Pick<BookSessionOptions, "bookMode" | "wsMode">,
): BookAttemptPlan {
  const requested: BookAttempt = { transport: options.wsMode ? "ws" : "rest", bookMode: options.bookMode };
  const caps = getBookCapabilities(target);
  const normalRest: BookAttempt = { transport: "rest", bookMode: "normal" };
  if (target.kind === "spot" && target.exchange === "Bitget" && target.isRealityToken) {
    return {
      attempts: [normalRest],
      notices: [{ code: "policy", reason: "reality-token", from: requested, to: normalRest,
        message: "rToken 使用真实普通 REST 盘口；不使用合成 BBO 数量或 RPI/WS。" }],
    };
  }
  const attempts: BookAttempt[] = [];
  const notices: BookAttemptPlan["notices"] = [];
  if (options.bookMode === "rpi") {
    if (caps[requested.transport].rpi) attempts.push(requested);
    else notices.push({ code: "unsupported", reason: "unsupported", from: requested,
      to: { transport: requested.transport, bookMode: "normal" },
      message: `${target.exchange} ${target.kind} 不支持 RPI ${requested.transport.toUpperCase()} 盘口，改用普通 ${requested.transport.toUpperCase()}。` });
  }
  if (options.wsMode) attempts.push({ transport: "ws", bookMode: "normal" });
  if (options.wsMode && options.bookMode === "rpi" && caps.rest.rpi) {
    attempts.push({ transport: "rest", bookMode: "rpi" });
  }
  attempts.push(normalRest);
  return { attempts, notices };
}
