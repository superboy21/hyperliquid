import { expect, test } from "bun:test";
import { alignedPairCloses } from "./pair-adapter";

test("pair adapter fails closed when legacy raw legs are missing", () => {
  expect(alignedPairCloses({ candles: [], fundingRates: [], interval: "1h" } as never)).toEqual([]);
});
