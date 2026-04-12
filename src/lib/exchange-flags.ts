export type ExchangeTransportMode = "native" | "ccxt";

function parseMode(value: string | undefined, fallback: ExchangeTransportMode): ExchangeTransportMode {
  return value === "ccxt" || value === "native" ? value : fallback;
}

export interface ExchangeTransportFlags {
  binance: ExchangeTransportMode;
  gateio: ExchangeTransportMode;
  hyperliquid: ExchangeTransportMode;
  lighter: ExchangeTransportMode;
}

export function getExchangeTransportFlags(): ExchangeTransportFlags {
  return {
    binance: parseMode(process.env.NEXT_PUBLIC_BINANCE_TRANSPORT_MODE, "ccxt"),
    gateio: parseMode(process.env.NEXT_PUBLIC_GATE_TRANSPORT_MODE, "native"),
    hyperliquid: parseMode(process.env.NEXT_PUBLIC_HYPERLIQUID_TRANSPORT_MODE, "native"),
    lighter: parseMode(process.env.NEXT_PUBLIC_LIGHTER_TRANSPORT_MODE, "native"),
  };
}
