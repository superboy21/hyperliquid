"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createBookSessionStore } from "../lib/order-book/session";
import type { BookMode, BookSessionState, BookTarget } from "../lib/order-book/types";

export function useLiveOrderBook(
  target: BookTarget | null,
  options: { enabled: boolean; bookMode: BookMode; wsMode: boolean },
): BookSessionState {
  // Scalar identity avoids reconnecting when table hydration recreates the row.
  // Include every transport/quantity identity field, not the display symbol alone.
  const key = target === null ? null : JSON.stringify({
    id: target.id, exchange: target.exchange, kind: target.kind, rawSymbol: target.rawSymbol,
    marketId: target.marketId, baseAsset: target.baseAsset, quoteAsset: target.quoteAsset,
    isRealityToken: target.isRealityToken,
  });
  const { enabled, bookMode, wsMode } = options;
  const store = useMemo(() => {
    const selected = key === null ? null : JSON.parse(key) as BookTarget;
    return createBookSessionStore(selected, { enabled, bookMode, wsMode });
  }, [key, enabled, bookMode, wsMode]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
