import { NextRequest, NextResponse } from "next/server";

// 资产分类映射
const ASSET_CATEGORIES: Record<string, string[]> = {
  "主流币": ["BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "TRX", "AVAX", "DOT", "LINK", "MATIC", "SHIB", "TON", "UNI", "LTC", "BCH", "NEAR", "ICP", "APT", "ATOM", "XLM", "FIL", "HBAR", "IMX", "INJ", "VET", "MKR", "GRT", "RUNE", "ALGO", "PEPE", "SEI", "SUI", "FET", "OP", "ARB", "TIA", "WIF", "PYTH", "JUP", "W", "ENA", "TAO", "ONDO", "RENDER", "FLOKI", "BONK", "ETC", "XMR", "DASH", "ZEC", "KAS", "BSV", "MINA", "ROSE", "CELO", "FLOW", "KLAY", "CFX", "WAVES", "HIVE", "QTUM", "IOST", "ZIL", "ICX", "XEM", "SC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC", "XDN", "XMY", "XST", "XZC"],
  
  "Meme": ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "BRETT", "MYRO", "BOME", "MOG", "DEGEN", "TURBO", "MEW", "BILLY", "POPCAT", "GIGA", "NEIRO", "BROCCOLIF3B", "TST", "BABYDOGE", "SAITAMA", "KISHU", "HOGE", "ELON", "CATE", "SHIBA", "LEASH", "BONE", "RYOSHI", "JACY", "NFT", "ASS", "PIG", "SAFEMOON", "FEG", "MOON", "DOBO", "HOKK", "DOG", "SHIELD", "KUMA"],
  
  "Layer 1": ["SOL", "ADA", "AVAX", "DOT", "NEAR", "APT", "ATOM", "FIL", "HBAR", "ICP", "ALGO", "SEI", "SUI", "TON", "KAS", "TIA", "INJ", "FTM", "EGLD", "XTZ", "EOS", "ICX", "ZIL", "QTUM", "IOTA", "NEO", "ONE", "XDC", "IOTX", "MINA", "ROSE", "CELO", "FLOW", "KLAY", "CFX", "WAVES", "HIVE", "IOST", "XEM", "SC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC", "XDN", "XMY", "XST", "XZC"],
  
  "Layer 2": ["MATIC", "OP", "ARB", "MANTA", "METIS", "STRK", "ZK", "MODE", "BLAST", "MERLIN", "ZETA", "POL", "BOBA", "LRC", "OMG", "ZRX", "CRO", "FTM", "BTT", "ANKR", "SKL", "CELR", "OXT", "NKN", "BAND", "OCEAN", "BNT", "NMR", "UMA", "REP", "KNC", "REN"],
  
  "DeFi": ["UNI", "LINK", "AAVE", "MKR", "CRV", "LDO", "COMP", "SUSHI", "SNX", "YFI", "BAL", "DYDX", "GMX", "RDNT", "PENDLE", "CVX", "1INCH", "RAY", "ORCA", "JUP", "CAKE", "BAKE", "AUTO", "ALPACA", "BELT", "XVS", "VAI", "ALPHA", "CREAM", "BUNNY", "FOR", "DODO", "BZRX", "IDEX", "DDX", "PERP", "MCB", "FIDA", "STEP", "COPE", "ROPE", "FARM", "PICKLE", "HARVEST", "BADGER", "DIGG", "INDEX", "DEFI5", "CC10", "NFTI", "PIPT", "YPIE", "SYFI", "SAFE", "SOCKS", "MEME", "PASTA", "TEND", "BASED", "YAM"],
  
  "AI": ["FET", "TAO", "RENDER", "WLD", "AGIX", "RNDR", "ARKM", "AIXBT", "VIRTUAL", "GRASS", "GOAT", "AI16Z", "ZEREBRO", "OCEAN", "NMR", "BAND"],
  
  "存储": ["FIL", "AR", "STORJ", "BTT", "SC", "XDN", "XMY", "XST", "XZC", "DCR", "RVN", "XVG", "ARDR", "NXT", "LSK", "STRAT", "KMD", "SYS", "VIA", "VTC"],
  
  "游戏": ["AXS", "SAND", "MANA", "GALA", "ILV", "ENJ", "SLP", "ALICE", "GMT", "STEPN", "XAI", "PRIME", "PORTAL", "RON", "TLM", "REVV", "TOWER", "GHST", "AURORA", "BLOK", "CEEK", "CHZ", "CHR", "COCOS", "COMBO", "COS", "CRE", "CTK", "CTSI", "CUDOS", "CVC", "DAR", "DEGO", "DIA", "DNT", "DOCK", "DUSK", "EDU", "ELF", "ENS", "EPX", "ERN", "ES", "FIS", "FLM", "FRONT", "FTT", "FUN", "GAL", "GFT", "GLM", "GMM", "GNO", "GNS", "GTC", "HARD", "HFT", "HIGH", "HOOK", "HOT", "JASMY", "JOE", "KAVA", "KDA", "KP3R", "KSM", "LAZIO", "LEVER", "LINA", "LIT", "LOOM", "LPT", "LQTY", "LTO", "LUNA", "LUNC", "MAGIC", "MASK", "MATH", "MBL", "MBOX", "MC", "MDT", "MFT", "MIR", "MITH", "MLN", "MOB", "MOVR", "MTL", "MULTI", "MV", "NANO", "NBS", "NEXO", "NULS", "OAX", "OG", "OGN", "OM", "OMG", "ONG", "ONT", "OOKI", "ORBS", "ORN", "PEOPLE", "PERL", "PHA", "PLA", "PNT", "POLS", "POLY", "POND", "POWR", "PROM", "PROS", "PSG", "PUNDIX", "PYR", "QI", "QKC", "QNT", "QUICK", "RAD", "RARE", "RARI", "REEF", "REI", "REQ", "RIF", "RLC", "RPL", "RSR", "SANTOS", "SCRT", "SFP", "SKL", "SPELL", "SRM", "SSV", "STEEM", "STG", "STMX", "STPT", "STRAX", "STX", "SUN", "SUPER", "SXP", "T", "TFUEL", "THETA", "TKO", "TOMO", "TORN", "TRB", "TRU", "TWT", "UNFI", "UOS", "USDP", "USTC", "UTK", "VEGA", "VGX", "VIB", "VIDT", "VITE", "VOXEL", "WAN", "WAXP", "WBTC", "WING", "WNXM", "WOO", "WRX", "WTC", "XEC", "XNO", "XVS", "XWG", "XYO", "YFII", "YGG", "ZEN"],
  
  "RWA": ["ONDO", "POLYX", "CFG", "CPOOL", "RSR", "RIO", "TRU", "MPL", "GFI", "CREDI", "CTC", "DETF", "ELDA", "JRT", "LEND", "NAOS", "OM", "OX", "PRO", "RAMP", "RARI", "RCN", "RDN"],
  
  "股票/指数": ["BABA", "TSLA", "NVDA", "AAPL", "AMZN", "META", "MSFT", "GOOGL", "NFLX", "INTC", "AMD", "COIN", "MSTR", "SPY", "QQQ", "JPM", "TSM", "SPX500", "NAS100", "US30", "TSLAX", "MSTRX", "SPYX", "COINX", "NVDAX", "QQQX", "CRCLX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX", "TLT", "AGG", "EURUSD", "GBPUSD", "HK50", "HKCHKD", "BVIX", "EVIX", "TW88", "PAYP", "GVZ", "EWY"],
  
  "商品": ["XAG", "XAU", "XBR", "XNG", "OIL", "GOLD", "SILVER", "COPPER", "PLATINUM", "PAXG", "XAUT", "XTI", "XPT", "XCU", "XPD", "XAL", "XNI", "XPB", "IAU", "SLVON"],
};

// 强制分类映射（优先级最高）
const FORCE_CATEGORY_MAP: Record<string, string> = {
  // 商品
  "XAUT_USDT": "商品",
  "XTI_USDT": "商品",
  "XPT_USDT": "商品",
  "XCU_USDT": "商品",
  "XPD_USDT": "商品",
  "XAL_USDT": "商品",
  "XNI_USDT": "商品",
  "XPB_USDT": "商品",
  "IAU_USDT": "商品",
  "SLVON_USDT": "商品",
  "PAXG_USDT": "商品",
  
  // 股票/指数
  "NVDAX_USDT": "股票/指数",
  "QQQX_USDT": "股票/指数",
  "CRCLX_USDT": "股票/指数",
  "AAPLX_USDT": "股票/指数",
  "GOOGLX_USDT": "股票/指数",
  "ORCLX_USDT": "股票/指数",
  "TQQQX_USDT": "股票/指数",
  "PLTRX_USDT": "股票/指数",
  "METAX_USDT": "股票/指数",
  "AMZNX_USDT": "股票/指数",
  "HOODX_USDT": "股票/指数",
  "TLT_USDT": "股票/指数",
  "AGG_USDT": "股票/指数",
  "EURUSD_USDT": "股票/指数",
  "GBPUSD_USDT": "股票/指数",
  "HK50_USDT": "股票/指数",
  "HKCHKD_USDT": "股票/指数",
  "BVIX_USDT": "股票/指数",
  "EVIX_USDT": "股票/指数",
  "TW88_USDT": "股票/指数",
};

// Crypto 相关的子分类
const CRYPTO_SUBCATEGORIES = ["主流币", "Meme", "Layer 1", "Layer 2", "DeFi", "AI", "存储", "游戏", "RWA"];

// 获取合约的资产类别
function getAssetCategory(contractName: string): string {
  // 优先检查强制分类映射
  if (FORCE_CATEGORY_MAP[contractName]) {
    return FORCE_CATEGORY_MAP[contractName];
  }
  
  const symbol = contractName.replace("_USDT", "").replace("_USD", "");
  
  for (const [category, symbols] of Object.entries(ASSET_CATEGORIES)) {
    if (symbols.includes(symbol)) {
      // 如果是 Crypto 子分类，统一返回 "Crypto"
      return CRYPTO_SUBCATEGORIES.includes(category) ? "Crypto" : category;
    }
  }
  
  return "其他";
}

export async function GET(request: NextRequest) {
  const baseUrl = "https://api.gateio.ws/api/v4";

  try {
    console.log(`[Gate API] Fetching from: ${baseUrl}`);
    
    // 先获取 tickers，再获取 contracts（避免并行请求导致限流）
    const tickersRes = await fetch(`${baseUrl}/futures/usdt/tickers`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!tickersRes.ok) {
      throw new Error(`Tickers API failed: ${tickersRes.status}`);
    }

    const tickers = await tickersRes.json();
    
    // 获取 contracts 数据（可选）
    let contracts: any[] = [];
    try {
      const contractsRes = await fetch(`${baseUrl}/futures/usdt/contracts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (contractsRes.ok) {
        contracts = await contractsRes.json();
      }
    } catch (e) {
      console.log("[Gate API] Contracts fetch failed, using default funding interval");
    }
    
    if (!Array.isArray(tickers)) {
      throw new Error("Invalid ticker response format");
    }

    // 创建 funding_interval 映射
    const fundingIntervalMap = new Map<string, number>();
    for (const contract of contracts) {
      if (contract.name && contract.funding_interval) {
        fundingIntervalMap.set(contract.name, contract.funding_interval);
      }
    }

    // 合并数据，添加资产类别
    const mergedTickers = tickers.map((ticker: any) => ({
      ...ticker,
      funding_interval: fundingIntervalMap.get(ticker.contract) || 28800,
      asset_category: getAssetCategory(ticker.contract),
    }));

    console.log(`[Gate API] Success, got ${mergedTickers.length} tickers`);
    return NextResponse.json(mergedTickers);
  } catch (error) {
    console.error("[Gate API] Error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch tickers" },
      { status: 500 }
    );
  }
}
