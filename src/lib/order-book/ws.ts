import { openPublicBookWs } from "./ws/public";
import { openCexBookWs } from "./ws/cex";
import type { BookWsOpener } from "./types";

/** Venue protocol, initialization, continuity and heartbeat live in the adapter. */
export const openBookWs: BookWsOpener = (target, options) => {
  switch (target.exchange) {
    case "Hyperliquid":
    case "Gate.io":
    case "Lighter":
      return openPublicBookWs(target, options);
    default:
      return openCexBookWs(target, options);
  }
};
