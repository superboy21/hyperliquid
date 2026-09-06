// Shared Gate futures request builders, transport policy, and ticker enrichment.
// This module deliberately has no Next.js/server dependencies: the browser
// client and the same-origin proxy route use the same request vocabulary.

import { getAbortReason, throwIfAborted } from "./utils/abort";
import { runDirectFirst } from "./utils/direct-first";

export type GateAction =
  | "tickers"
  | "contracts"
  | "funding-rate"
  | "funding-rates"
  | "candlesticks"
  | "premium-index"
  | "order-book";

export interface GateUpstreamRequest {
  url: string;
  init: RequestInit & { timeout?: number };
}

export const GATE_API_ORIGIN = "https://api.gateio.ws";
export const GATE_API_BASE = `${GATE_API_ORIGIN}/api/v4`;

const ACTION_PATHS: Record<GateAction, string> = {
  tickers: "/futures/usdt/tickers",
  contracts: "/futures/usdt/contracts",
  "funding-rate": "/futures/usdt/funding_rate",
  "funding-rates": "/futures/usdt/funding_rates",
  candlesticks: "/futures/usdt/candlesticks",
  "premium-index": "/futures/usdt/premium_index",
  "order-book": "/futures/usdt/order_book",
};

const PROXY_PATHS: Record<GateAction, string> = {
  tickers: "/api/gate/futures/usdt/tickers",
  contracts: "/api/gate/futures/usdt/contracts",
  "funding-rate": "/api/gate/futures/usdt/funding_rate",
  "funding-rates": "/api/gate/futures/usdt/funding_rates",
  candlesticks: "/api/gate/futures/usdt/candlesticks",
  "premium-index": "/api/gate/futures/usdt/premium_index",
  "order-book": "/api/gate/futures/usdt/order_book",
};

const ACTION_PARAMS: Record<GateAction, readonly string[]> = {
  tickers: ["contract"],
  contracts: [],
  "funding-rate": ["contract", "limit", "from", "to"],
  "funding-rates": [],
  candlesticks: ["contract", "interval", "limit"],
  "premium-index": ["contract", "limit", "from", "to", "interval"],
  "order-book": ["contract", "interval", "limit", "book", "rpi"],
};

function appendParams(url: URL, params: Record<string, string>, allowed: readonly string[]) {
  for (const key of allowed) {
    const value = params[key];
    if (value !== undefined) url.searchParams.set(key, value);
  }
}

/** Build the public Gate v4 URL. Values are encoded by URLSearchParams. */
export function buildGateUrl(action: GateAction, params: Record<string, string> = {}): string {
  const url = new URL(`${GATE_API_BASE}${ACTION_PATHS[action]}`);
  let path = ACTION_PATHS[action];

  if (action === "order-book" && params.rpi === "1") {
    path = "/futures/usdt/rpi_order_book";
    url.pathname = `/api/v4${path}`;
  }

  appendParams(url, params, ACTION_PARAMS[action]);
  if (action === "order-book") {
    url.searchParams.delete("rpi");
    if (params.interval === "book" || params.book === "1") {
      url.searchParams.set("with_book", "true");
    }
    url.searchParams.delete("interval");
    url.searchParams.delete("book");
  }
  return url.toString();
}

/** Build the matching same-origin proxy URL, retaining its public query contract. */
export function buildGateProxyUrl(action: GateAction, params: Record<string, string> = {}): string {
  const url = new URL(PROXY_PATHS[action], "http://localhost");
  appendParams(url, params, ACTION_PARAMS[action]);
  return `${url.pathname}${url.search}`;
}

export function buildGateBatchProxyRequest(contracts: string[]): GateUpstreamRequest {
  return {
    url: buildGateProxyUrl("funding-rates"),
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contracts }),
      cache: "no-store",
    },
  };
}

export function buildGateRequest(action: GateAction, params: Record<string, string> = {}): GateUpstreamRequest {
  const method = action === "funding-rates" ? "POST" : "GET";
  return {
    url: buildGateUrl(action, params),
    init: {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
      timeout: 10_000,
    },
  };
}

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
export interface GateTransportOptions {
  fetch?: typeof fetch;
  sleep?: Sleep;
  requestTimeoutMs?: number;
  now?: () => number;
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  // Resolve the ambient fetch at call time so browser-side consumers and tests
  // can replace globalThis.fetch without making the module-level requestGate
  // retain the old function reference.
  return fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

export class GateTimeoutError extends Error {
  constructor() {
    super("Gate client request timed out");
    this.name = "TimeoutError";
  }
}

const defaultSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  throwIfAborted(signal);
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reject(getAbortReason(signal));
  }
  signal?.addEventListener("abort", onAbort, { once: true });
});

function retryAfterMs(response: Response, now: () => number): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
  return Number.isFinite(parsed) ? Math.max(0, Math.min(5_000, parsed)) : null;
}

async function fetchWithClientTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (timedOut) throw new GateTimeoutError();
    return response;
  } catch (error) {
    if (signal?.aborted) throw getAbortReason(signal);
    if (timedOut) throw new GateTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Direct leg only. 429 gets a small, cancellable, bounded retry and is never proxied. */
export function createGateDirectRequest(options: GateTransportOptions = {}) {
  const fetchImpl = resolveFetch(options.fetch);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.requestTimeoutMs ?? 10_000;

  return async (
    action: GateAction,
    params: Record<string, string> = {},
    signal?: AbortSignal,
    reportResponse?: (response: Response) => void,
  ): Promise<Response> => {
    const request = buildGateRequest(action, params);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchWithClientTimeout(fetchImpl, request.url, request.init, timeoutMs, signal);
      reportResponse?.(response);
      if (response.status !== 429 || attempt === 1) return response;
      const retry = retryAfterMs(response, now);
      await sleep(retry ?? 1_000, signal);
    }
    throw new Error("Unreachable Gate retry state");
  };
}

/** Direct-first request for one REST endpoint. The proxy is consulted at most once. */
export function createGateRequest(options: GateTransportOptions = {}) {
  const fetchImpl = resolveFetch(options.fetch);
  const direct = createGateDirectRequest(options);
  return async (action: GateAction, params: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> => {
    const request = buildGateRequest(action, params);
    return runDirectFirst({
      signal,
      directTimeoutMs: options.requestTimeoutMs ?? 10_000,
      direct: (directSignal, reportResponse) => direct(action, params, directSignal, reportResponse),
      proxy: () => fetchImpl(buildGateProxyUrl(action, params), { ...request.init, signal }),
    });
  };
}

export const requestGate: ReturnType<typeof createGateRequest> = createGateRequest();

// ==================== Shared ticker/contracts enrichment ====================

const ASSET_CATEGORIES: Record<string, string[]> = {
  "主流币": ["BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "TRX", "AVAX", "DOT", "LINK", "MATIC", "SHIB", "TON", "UNI", "LTC", "BCH", "NEAR", "ICP", "APT", "ATOM", "XLM", "FIL", "HBAR", "IMX", "INJ", "VET", "MKR", "GRT", "RUNE", "ALGO", "PEPE", "SEI", "SUI", "FET", "OP", "ARB", "TIA", "WIF", "PYTH", "JUP", "W", "ENA", "TAO", "ONDO", "RENDER", "FLOKI", "BONK", "ETC", "XMR", "DASH", "ZEC", "KAS", "BSV", "MINA", "ROSE", "CELO", "FLOW", "KLAY", "CFX", "WAVES", "HIVE", "QTUM", "IOST", "ZIL", "ICX", "XEM", "SC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC", "XDN", "XMY", "XST", "XZC"],
  Meme: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "BRETT", "MYRO", "BOME", "MOG", "DEGEN", "TURBO", "MEW", "BILLY", "POPCAT", "GIGA", "NEIRO", "BROCCOLIF3B", "TST", "BABYDOGE", "SAITAMA", "KISHU", "HOGE", "ELON", "CATE", "SHIBA", "LEASH", "BONE", "RYOSHI", "JACY", "NFT", "ASS", "PIG", "SAFEMOON", "FEG", "MOON", "DOBO", "HOKK", "DOG", "SHIELD", "KUMA"],
  "Layer 1": ["SOL", "ADA", "AVAX", "DOT", "NEAR", "APT", "ATOM", "FIL", "HBAR", "ICP", "ALGO", "SEI", "SUI", "TON", "KAS", "TIA", "INJ", "FTM", "EGLD", "XTZ", "EOS", "ICX", "ZIL", "QTUM", "IOTA", "NEO", "ONE", "XDC", "IOTX", "MINA", "ROSE", "CELO", "FLOW", "KLAY", "CFX", "WAVES", "HIVE", "IOST", "XEM", "SC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC", "XDN", "XMY", "XST", "XZC"],
  "Layer 2": ["MATIC", "OP", "ARB", "MANTA", "METIS", "STRK", "ZK", "MODE", "BLAST", "MERLIN", "ZETA", "POL", "BOBA", "LRC", "OMG", "ZRX", "CRO", "FTM", "BTT", "ANKR", "SKL", "CELR", "OXT", "NKN", "BAND", "OCEAN", "BNT", "NMR", "UMA", "REP", "KNC", "REN"],
  DeFi: ["UNI", "LINK", "AAVE", "MKR", "CRV", "LDO", "COMP", "SUSHI", "SNX", "YFI", "BAL", "DYDX", "GMX", "RDNT", "PENDLE", "CVX", "1INCH", "RAY", "ORCA", "JUP", "CAKE", "BAKE", "AUTO", "ALPACA", "BELT", "XVS", "VAI", "ALPHA", "CREAM", "BUNNY", "FOR", "DODO", "BZRX", "IDEX", "DDX", "PERP", "MCB", "FIDA", "STEP", "COPE", "ROPE", "FARM", "PICKLE", "HARVEST", "BADGER", "DIGG", "INDEX", "DEFI5", "CC10", "NFTI", "PIPT", "YPIE", "SYFI", "SAFE", "SOCKS", "MEME", "PASTA", "TEND", "BASED", "YAM"],
  AI: ["FET", "TAO", "RENDER", "WLD", "AGIX", "RNDR", "ARKM", "AIXBT", "VIRTUAL", "GRASS", "GOAT", "AI16Z", "ZEREBRO", "OCEAN", "NMR", "BAND"],
  存储: ["FIL", "AR", "STORJ", "BTT", "SC", "XDN", "XMY", "XST", "XZC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC"],
  游戏: ["AXS", "SAND", "MANA", "GALA", "ILV", "ENJ", "SLP", "ALICE", "GMT", "STEPN", "XAI", "PRIME", "PORTAL", "RON", "TLM", "REVV", "TOWER", "GHST", "AURORA", "BLOK", "CEEK", "CHZ", "CHR", "COCOS", "COMBO", "COS", "CRE", "CTK", "CTSI", "CUDOS", "CVC", "DAR", "DEGO", "DIA", "DNT", "DOCK", "DUSK", "EDU", "ELF", "ENS", "EPX", "ERN", "ES", "FIS", "FLM", "FRONT", "FTT", "FUN", "GAL", "GFT", "GLM", "GMM", "GNO", "GNS", "GTC", "HARD", "HFT", "HIGH", "HOOK", "HOT", "JASMY", "JOE", "KAVA", "KDA", "KP3R", "KSM", "LAZIO", "LEVER", "LINA", "LIT", "LOOM", "LPT", "LQTY", "LTO", "LUNA", "LUNC", "MAGIC", "MASK", "MATH", "MBL", "MBOX", "MC", "MDT", "MFT", "MIR", "MITH", "MLN", "MOB", "MOVR", "MTL", "MULTI", "MV", "NANO", "NBS", "NEXO", "NULS", "OAX", "OG", "OGN", "OM", "OMG", "ONG", "ONT", "OOKI", "ORBS", "ORN", "PEOPLE", "PERL", "PHA", "PLA", "PNT", "POLS", "POLY", "POND", "POWR", "PROM", "PROS", "PSG", "PUNDIX", "PYR", "QI", "QKC", "QNT", "QUICK", "RAD", "RARE", "RARI", "REEF", "REI", "REQ", "RIF", "RLC", "RPL", "RSR", "SANTOS", "SCRT", "SFP", "SKL", "SPELL", "SRM", "SSV", "STEEM", "STG", "STMX", "STPT", "STRAX", "STX", "SUN", "SUPER", "SXP", "T", "TFUEL", "THETA", "TKO", "TOMO", "TORN", "TRB", "TRU", "TWT", "UNFI", "UOS", "USDP", "USTC", "UTK", "VEGA", "VGX", "VIB", "VIDT", "VITE", "VOXEL", "WAN", "WAXP", "WBTC", "WING", "WNXM", "WOO", "WRX", "WTC", "XEC", "XNO", "XVS", "XWG", "XYO", "YFII", "YGG", "ZEN"],
  RWA: ["ONDO", "POLYX", "CFG", "CPOOL", "RSR", "RIO", "TRU", "MPL", "GFI", "CREDI", "CTC", "DETF", "ELDA", "JRT", "LEND", "NAOS", "OM", "OX", "PRO", "RAMP", "RARI", "RCN", "RDN"],
  "股票/指数": ["BABA", "TSLA", "NVDA", "AAPL", "AMZN", "META", "MSFT", "GOOGL", "NFLX", "INTC", "AMD", "COIN", "MSTR", "SPY", "QQQ", "JPM", "TSM", "SPX500", "NAS100", "US30", "TSLAX", "MSTRX", "SPYX", "COINX", "NVDAX", "QQQX", "CRCLX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX", "TLT", "AGG", "EURUSD", "GBPUSD", "HK50", "HKCHKD", "BVIX", "EVIX", "TW88", "PAYP", "GVZ", "EWY"],
  商品: ["XAG", "XAU", "XBR", "XNG", "OIL", "GOLD", "SILVER", "COPPER", "PLATINUM", "PAXG", "XAUT", "XTI", "XPT", "XCU", "XPD", "XAL", "XNI", "XPB", "IAU", "SLVON"],
};
const FORCE_CATEGORY_MAP: Record<string, string> = {
  XAUT_USDT: "商品", XTI_USDT: "商品", XPT_USDT: "商品", XCU_USDT: "商品", XPD_USDT: "商品", XAL_USDT: "商品", XNI_USDT: "商品", XPB_USDT: "商品", IAU_USDT: "商品", SLVON_USDT: "商品", PAXG_USDT: "商品",
  NVDAX_USDT: "股票/指数", QQQX_USDT: "股票/指数", CRCLX_USDT: "股票/指数", AAPLX_USDT: "股票/指数", GOOGLX_USDT: "股票/指数", ORCLX_USDT: "股票/指数", TQQQX_USDT: "股票/指数", PLTRX_USDT: "股票/指数", METAX_USDT: "股票/指数", AMZNX_USDT: "股票/指数", HOODX_USDT: "股票/指数", TLT_USDT: "股票/指数", AGG_USDT: "股票/指数", EURUSD_USDT: "股票/指数", GBPUSD_USDT: "股票/指数", HK50_USDT: "股票/指数", HKCHKD_USDT: "股票/指数", BVIX_USDT: "股票/指数", EVIX_USDT: "股票/指数", TW88_USDT: "股票/指数",
};
const CRYPTO_SUBCATEGORIES = new Set(["主流币", "Meme", "Layer 1", "Layer 2", "DeFi", "AI", "存储", "游戏", "RWA"]);

export function getGateAssetCategory(contractName: string): string {
  if (FORCE_CATEGORY_MAP[contractName]) return FORCE_CATEGORY_MAP[contractName];
  const symbol = contractName.replace("_USDT", "").replace("_USD", "");
  for (const [category, symbols] of Object.entries(ASSET_CATEGORIES)) {
    if (symbols.includes(symbol)) return CRYPTO_SUBCATEGORIES.has(category) ? "Crypto" : category;
  }
  return "其他";
}

/** Contracts must enrich every non-empty ticker response. */
export function hasCompleteGateTickerEnrichment(tickers: unknown, contracts: unknown): boolean {
  // An empty ticker response is a legitimate result and needs no metadata.
  if (!Array.isArray(tickers)) return false;
  if (tickers.length === 0) return true;
  if (!Array.isArray(contracts)) return false;

  const fundingIntervals = new Map<string, number>();
  for (const item of contracts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as { name?: unknown; funding_interval?: unknown };
    if (typeof row.name !== "string") continue;
    const interval = typeof row.funding_interval === "number"
      ? row.funding_interval
      : Number(row.funding_interval);
    if (Number.isFinite(interval) && interval > 0) fundingIntervals.set(row.name, interval);
  }

  return tickers.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const contract = (item as { contract?: unknown }).contract;
    return typeof contract === "string" && fundingIntervals.has(contract);
  });
}

export function enrichGateTickers(tickers: unknown, contracts: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tickers)) return [];
  const fundingIntervals = new Map<string, number>();
  if (Array.isArray(contracts)) {
    for (const item of contracts) {
      if (!item || typeof item !== "object") continue;
      const row = item as { name?: unknown; funding_interval?: unknown };
      if (typeof row.name === "string" && row.funding_interval) fundingIntervals.set(row.name, Number(row.funding_interval));
    }
  }
  return tickers.map((ticker) => {
    if (!ticker || typeof ticker !== "object") return ticker as Record<string, unknown>;
    const row = ticker as Record<string, unknown>;
    const contract = typeof row.contract === "string" ? row.contract : "";
    return { ...row, funding_interval: fundingIntervals.get(contract) || 28_800, asset_category: getGateAssetCategory(contract) };
  });
}
