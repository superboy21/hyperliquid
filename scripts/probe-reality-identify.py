# -*- coding: utf-8 -*-
# 验证：1) Bitget SPOT instruments 是否支持不带 symbol 的全量查询及 isReality 字段
#       2) v2 spot tickers 全量响应里 RAAPL 的完整字段（有无 rToken 标记）
import json
import urllib.request
import urllib.error

PROXY = "http://127.0.0.1:10808"
BASE = "https://api.bitget.com"

def fetch(url: str):
    proxy_handler = urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
    opener = urllib.request.build_opener(proxy_handler)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with opener.open(req, timeout=25) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")[:500]

print("== 1) v3 instruments category=SPOT 不带 symbol ==")
status, data = fetch(f"{BASE}/api/v3/market/instruments?category=SPOT")
print(f"  HTTP {status}")
if status == 200:
    rows = data.get("data", [])
    print(f"  total rows: {len(rows)}")
    if rows:
        print(f"  first row keys: {list(rows[0].keys())}")
        print(f"  first row: {json.dumps(rows[0], ensure_ascii=False)[:400]}")
    # 找 RAAPL
    for r in rows:
        if r.get("symbol") == "RAAPLUSDT":
            print(f"  RAAPLUSDT row: {json.dumps(r, ensure_ascii=False)[:500]}")
            break
    # 统计 isReality=yes 数量
    reality = [r for r in rows if r.get("isReality") == "yes"]
    print(f"  isReality=yes count: {len(reality)}")
    print(f"  isReality=yes symbols (前20): {[r.get('symbol') for r in reality[:20]]}")
else:
    print(f"  {data}")

print()
print("== 2) v2 spot tickers 全量里 RAAPL 的完整字段 ==")
status, data = fetch(f"{BASE}/api/v2/spot/market/tickers")
print(f"  HTTP {status}")
if status == 200:
    rows = data.get("data", [])
    print(f"  total rows: {len(rows)}")
    for r in rows:
        if r.get("symbol") == "RAAPLUSDT":
            print(f"  RAAPLUSDT ticker: {json.dumps(r, ensure_ascii=False)}")
            break
else:
    print(f"  {data}")
