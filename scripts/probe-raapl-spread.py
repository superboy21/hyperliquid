# -*- coding: utf-8 -*-
# 调研 RAAPLUSDT 现货：为什么 API orderbook 价差（0.265%）远大于 Bitget App 显示的 0.01-0.02 USD。
# 1) v2 spot tickers 的 bid1/ask1（App 可能用这个）
# 2) v3 tickers category=SPOT 的 bid1Pr/ask1Pr
# 3) orderbook 连续采样看是否低频缓存
# 4) rpi-orderbook 连续采样看 RPI 量是否稳定为 0
import json
import time
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

def spread(bid, ask):
    if bid and ask:
        mid = (bid + ask) / 2
        return (ask - bid) / mid * 100, ask - bid
    return None, None

print("== 1) v2 spot tickers（单 symbol）==")
for i in range(3):
    status, data = fetch(f"{BASE}/api/v2/spot/market/tickers?symbol=RAAPLUSDT")
    if status == 200:
        rows = data.get("data", [])
        for row in rows[:2]:
            bid, ask = float(row.get("bid1Pr") or row.get("bidPr") or 0), float(row.get("ask1Pr") or row.get("askPr") or 0)
            pct, abs_ = spread(bid, ask)
            print(f"  sample{i}: bid1={bid} ask1={ask} last={row.get('lastPr')} spread={abs_} USD ({pct:.4f}%)")
    else:
        print(f"  HTTP {status}: {data}")
    time.sleep(0.5)

print()
print("== 2) v3 tickers category=SPOT ==")
status, data = fetch(f"{BASE}/api/v3/market/tickers?category=SPOT&symbol=RAAPLUSDT")
print(f"  HTTP {status}")
if status == 200:
    rows = data.get("data", [])
    for row in rows[:2]:
        print(f"  raw: {json.dumps(row, ensure_ascii=False)[:300]}")
        bid = float(row.get("bid1Pr") or 0)
        ask = float(row.get("ask1Pr") or 0)
        if bid and ask:
            pct, abs_ = spread(bid, ask)
            print(f"  bid1Pr={bid} ask1Pr={ask} lastPr={row.get('lastPr')} spread={abs_} USD ({pct:.4f}%)")
else:
    print(f"  {data}")

print()
print("== 3) v2 orderbook 连续采样 5 次（每 2s）==")
prev = None
for i in range(5):
    status, data = fetch(f"{BASE}/api/v2/spot/market/orderbook?symbol=RAAPLUSDT&limit=5&type=step0")
    if status == 200:
        d = data.get("data", data)
        asks = d.get("asks") or []
        bids = d.get("bids") or []
        ba = float(asks[0][0]) if asks else None
        bb = float(bids[0][0]) if bids else None
        pct, abs_ = spread(bb, ba)
        ts = d.get("ts") or d.get("timestamp")
        same = "SAME" if (bb, ba) == prev else "changed"
        prev = (bb, ba)
        print(f"  sample{i}: bid={bb} ask={ba} spread={abs_} USD ({pct:.4f}%) ts={ts} [{same}]")
    else:
        print(f"  HTTP {status}: {data}")
    time.sleep(2)

print()
print("== 4) rpi-orderbook 连续采样 3 次（每 2s）==")
for i in range(3):
    status, data = fetch(f"{BASE}/api/v3/market/rpi-orderbook?category=SPOT&symbol=RAAPLUSDT&limit=5")
    if status == 200:
        d = data.get("data", data)
        asks = d.get("a") or []
        bids = d.get("b") or []
        print(f"  sample{i}: asks={json.dumps(asks[:3], ensure_ascii=False)} bids={json.dumps(bids[:3], ensure_ascii=False)}")
    else:
        print(f"  HTTP {status}: {data}")
    time.sleep(2)

print()
print("== 5) 现货 tickers 批量端点（v2，全量找 RAAPL）==")
status, data = fetch(f"{BASE}/api/v2/spot/market/tickers")
if status == 200:
    rows = data.get("data", [])
    for row in rows:
        if row.get("symbol") == "RAAPLUSDT":
            bid = float(row.get("bid1Pr") or row.get("bidPr") or 0)
            ask = float(row.get("ask1Pr") or row.get("askPr") or 0)
            pct, abs_ = spread(bid, ask)
            print(f"  RAAPLUSDT: bid1={bid} ask1={ask} last={row.get('lastPr')} spread={abs_} USD ({pct:.4f}%)")
            break
else:
    print(f"  HTTP {status}: {data}")
