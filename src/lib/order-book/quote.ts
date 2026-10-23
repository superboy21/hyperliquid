/**
 * USD-pegged quote naming used by the combination book.
 *
 * Membership is decided by a case-insensitive *substring* test, never by a
 * prefix, so FDUSD/TUSD/USDE/USD1/BUSD and friends all count while a base asset
 * that happens to contain "USD" is irrelevant: only the quote name is inspected.
 */
export function isUsdQuote(name: string): boolean {
  return typeof name === "string" && name.trim().toUpperCase().includes("USD");
}
