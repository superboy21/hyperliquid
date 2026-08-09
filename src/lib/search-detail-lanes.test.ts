import { describe, expect, test } from "bun:test";
import { DETAIL_LANE_PROFILE } from "./search-detail-lanes";

describe("progressive detail lane profile", () => {
  test("selects concurrency 2 for independent Bybit detail rows without row delay", () => {
    expect(DETAIL_LANE_PROFILE.bybit).toEqual({ concurrency: 2, delayMs: 0 });
  });

  test("keeps every other exchange lane unchanged", () => {
    expect(DETAIL_LANE_PROFILE.generic).toEqual({ concurrency: 4, delayMs: 0 });
    expect(DETAIL_LANE_PROFILE.lighter).toEqual({ concurrency: 1, delayMs: 200 });
    expect(DETAIL_LANE_PROFILE.bitget).toEqual({ concurrency: 1, delayMs: 0 });
    expect(DETAIL_LANE_PROFILE.okx).toEqual({ concurrency: 1, delayMs: 200 });
  });
});
