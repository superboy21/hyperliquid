// ==================== Symbol Display Name Mapping ====================
// Maps Hyperliquid API internal names to spec display names.
// Keep rawSymbol as API name; use display names only for UI.

/** Para Hip3 API → display */
const PARA_API_TO_DISPLAY: Record<string, string> = {
  "para:BTCD": "para:BTC.D",
};

/** XYZ Hip3 API → display (spec names) */
const XYZ_API_TO_DISPLAY: Record<string, string> = {
  "xyz:CL": "xyz:WTIOIL",
  "xyz:SKHX": "xyz:SKHYNIX",
  "xyz:SMSN": "xyz:SAMSUNG",
};

/** Combined API → display mapping */
export const API_TO_DISPLAY: Record<string, string> = {
  ...PARA_API_TO_DISPLAY,
  ...XYZ_API_TO_DISPLAY,
};

/** Convert API symbol to display symbol (returns input if no mapping exists) */
export function toDisplaySymbol(apiSymbol: string): string {
  return API_TO_DISPLAY[apiSymbol] ?? apiSymbol;
}

/** Convert display symbol back to API symbol (returns input if no mapping exists) */
export function toApiSymbol(displaySymbol: string): string {
  for (const [api, display] of Object.entries(API_TO_DISPLAY)) {
    if (display === displaySymbol) return api;
  }
  return displaySymbol;
}
