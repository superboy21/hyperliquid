import { describe, expect, test } from "bun:test";
import { aggregateSpot4hToDaily, aggregateSpot4hToWeekly, aggregateSpotDailyToWeekly, normalizeSpotCandles, resolveSpotCandleSource, takeMostRecentCandles } from "./spot-search-candles";

describe("spot candle normalizers", () => {
  test("maps Gate's nonstandard array order and sorts/deduplicates timestamps", () => {
    const candles = normalizeSpotCandles("Gate.io", [
      ["2", "220", "11", "12", "9", "10", "20"],
      ["1", "100", "10", "11", "8", "9", "10"],
      ["2", "220", "11", "12", "9", "10", "20"],
    ], "1m");
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ openTime: 1000, open: "9", close: "10", volume: "10", quoteVolume: "100" });
  });

  test("keeps Bitget base and quote volume fields distinct", () => {
    const candles = normalizeSpotCandles("Bitget", { data: [["1000", "1", "3", "0.5", "2", "12", "24", "25"]] }, "1m");
    expect(candles[0]).toMatchObject({ volume: "12", quoteVolume: "24" });
  });

  test("converts Bybit newest-first V5 kline tuples to ascending candles with turnover as quote volume", () => {
    const candles = normalizeSpotCandles("Bybit", {
      retCode: 0,
      retMsg: "OK",
      result: { list: [
        ["3000000000000", "12", "13", "11", "12.5", "30", "360"],
        ["2000000000000", "10", "11", "9", "10", "20", "200"],
        ["1000000000000", "8", "9", "7", "8", "10", "80"],
        ["1000000000000", "8", "9", "7", "8", "10", "80"],
      ] },
    }, "1m");
    expect(candles.map((candle) => candle.openTime)).toEqual([1000000000000, 2000000000000, 3000000000000]);
    expect(candles[0]).toMatchObject({ openTime: 1000000000000, closeTime: 1000000060000, open: "8", high: "9", low: "7", close: "8", volume: "10", quoteVolume: "80" });
    expect(candles[2]).toMatchObject({ openTime: 3000000000000, closeTime: 3000000060000, close: "12.5", volume: "30", quoteVolume: "360" });
  });

  test("tolerates Bybit tuples without turnover and non-array rows", () => {
    const candles = normalizeSpotCandles("Bybit", {
      result: { list: [
        ["1000000000000", "8", "9", "7", "8", "10"],
        "garbage",
        { symbol: "BTCUSDT" },
      ] },
    }, "5m");
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ openTime: 1000000000000, volume: "10" });
    expect(candles[0].quoteVolume).toBe("0");
  });
});

describe("spot weekly candle source policy", () => {
  test("uses Hyperliquid native weeks for singles and UTC daily aggregation for combos", () => {
    expect(resolveSpotCandleSource("Hyperliquid", "1w")).toEqual({ sourceInterval: "1w", aggregateWeekly: false });
    expect(resolveSpotCandleSource("Hyperliquid", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
  });

  test("aggregates Lighter single and combo weeks from official UTC days", () => {
    expect(resolveSpotCandleSource("Lighter", "1w")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
    expect(resolveSpotCandleSource("Lighter", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
    const monday = Date.UTC(2026, 6, 13);
    expect(aggregateSpotDailyToWeekly([
      { openTime: monday, closeTime: monday + 86_400_000, open: "1", high: "2", low: "1", close: "2", volume: "3" },
      { openTime: monday + 86_400_000, closeTime: monday + 2 * 86_400_000, open: "2", high: "4", low: "1.5", close: "3", volume: "5" },
    ])[0]).toMatchObject({ openTime: monday, open: "1", high: "4", low: "1", close: "3", volume: "8" });
  });
});

describe("Bitget rToken 4h aggregation", () => {
  // 4h 蜡烛是 UTC 对齐的：00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00
  const day = Date.UTC(2026, 7, 13); // 2026-08-13 00:00 UTC
  const fourHour = (hour: number, open: number, close: number, high: number, low: number, volume: number) => ({
    openTime: day + hour * 3_600_000,
    closeTime: day + (hour + 4) * 3_600_000,
    open: String(open), close: String(close), high: String(high), low: String(low), volume: String(volume),
  });

  test("aggregates six UTC-aligned 4h candles into one UTC day", () => {
    const candles = [
      fourHour(0, 10, 11, 12, 9, 1),
      fourHour(4, 11, 13, 14, 10, 2),
      fourHour(8, 13, 12, 15, 11, 3),
      fourHour(12, 12, 14, 16, 12, 4),
      fourHour(16, 14, 13, 15, 13, 5),
      fourHour(20, 13, 15, 17, 12, 6),
    ];
    const daily = aggregateSpot4hToDaily(candles);
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({
      openTime: day,
      closeTime: day + 86_400_000,
      open: "10", close: "15", high: "17", low: "9", volume: "21",
    });
  });

  test("keeps days on UTC boundaries and splits a UTC+8-aligned 1day into two UTC days", () => {
    // 一个 UTC 日（08-13）的 6 根，加下一个 UTC 日（08-14）的前 2 根
    const day2 = day + 86_400_000;
    const candles = [
      fourHour(0, 10, 11, 12, 9, 1),
      fourHour(4, 11, 12, 13, 10, 1),
      fourHour(8, 12, 13, 14, 11, 1),
      fourHour(12, 13, 14, 15, 12, 1),
      fourHour(16, 14, 15, 16, 13, 1),
      fourHour(20, 15, 16, 17, 14, 1),
      { openTime: day2, closeTime: day2 + 14_400_000, open: "16", close: "18", high: "19", low: "15", volume: "2" },
      { openTime: day2 + 14_400_000, closeTime: day2 + 28_800_000, open: "18", close: "17", high: "18", low: "16", volume: "2" },
    ];
    const daily = aggregateSpot4hToDaily(candles);
    expect(daily).toHaveLength(2);
    expect(daily[0].openTime).toBe(day);
    expect(daily[1].openTime).toBe(day2);
    expect(daily[0]).toMatchObject({ open: "10", close: "16", high: "17", low: "9", volume: "6" });
    expect(daily[1]).toMatchObject({ open: "16", close: "17", high: "19", low: "15", volume: "4" });
  });

  test("aggregates 4h candles into UTC Monday-aligned weeks", () => {
    const monday = Date.UTC(2026, 7, 10); // 2026-08-10 是周一
    // 周一 00:00 到周三 20:00 的 4h 蜡烛（跨周）
    const points: Array<ReturnType<typeof fourHour>> = [];
    for (let hour = 0; hour < 72; hour += 4) {
      points.push({ openTime: monday + hour * 3_600_000, closeTime: monday + (hour + 4) * 3_600_000, open: "1", close: "2", high: "3", low: "1", volume: "1" });
    }
    const weekly = aggregateSpot4hToWeekly(points);
    expect(weekly).toHaveLength(1);
    expect(weekly[0].openTime).toBe(monday);
    expect(weekly[0].volume).toBe("18"); // 72h / 4h = 18 根
  });

  test("keeps the most recent candles from an ascending series", () => {
    // 模拟 rToken 历史长于 limit 的场景：聚合出 5 根升序日线，只要最近 3 根
    const ascending = [1, 2, 3, 4, 5].map((n) => ({ openTime: n }));
    expect(takeMostRecentCandles(ascending, 3).map((c) => c.openTime)).toEqual([3, 4, 5]);
    // limit 大于长度时返回全部
    expect(takeMostRecentCandles(ascending, 10)).toHaveLength(5);
  });
});
