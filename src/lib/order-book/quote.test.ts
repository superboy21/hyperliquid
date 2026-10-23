import { describe, expect, test } from "bun:test";
import { isUsdQuote } from "./quote";

describe("isUsdQuote", () => {
  test("accepts every USD-pegged quote name case-insensitively", () => {
    for (const name of [
      "USD", "usd", "USDT", "usdt", "USDC", "FDUSD", "BUSD", "TUSD", "USD1", "USDE",
      "usdd", "IBUSD", "HUSD", " fdusd ",
    ]) {
      expect(isUsdQuote(name)).toBe(true);
    }
  });

  test("rejects non-USD quotes and non-strings", () => {
    for (const name of ["", " ", "BTC", "ETH", "EUR", "TRY", "U"]) {
      expect(isUsdQuote(name)).toBe(false);
    }
    for (const value of [undefined, null, 0, {}, []]) {
      expect(isUsdQuote(value as unknown as string)).toBe(false);
    }
  });

  test("matches the quote name by substring, so a prefix-only test would fail", () => {
    // FDUSD/BUSD/TUSD do not start with "USD"; startsWith would reject them.
    for (const name of ["FDUSD", "BUSD", "TUSD"]) {
      expect(name.startsWith("USD")).toBe(false);
      expect(isUsdQuote(name)).toBe(true);
    }
  });
});
