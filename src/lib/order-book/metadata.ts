import { getGateQuantoMultiplier } from "../gateio";
import { okxFetch } from "../adapters/okx";
import { throwIfAborted } from "../utils/abort";
import { BookError, type BookTarget } from "./types";

const successful = new Map<string, number>();
export function clearBookQuantityMultiplierCache(): void { successful.clear(); }

/** Convert a contract's native quantity into base-asset quantity. */
export async function getBookQuantityMultiplier(target: BookTarget, signal?: AbortSignal): Promise<number> {
  throwIfAborted(signal);
  if (target.kind === "spot" || (target.exchange !== "Gate.io" && target.exchange !== "OKX")) return 1;
  const key = `${target.exchange}:${target.kind}:${target.rawSymbol}:${target.baseAsset.toUpperCase()}`;
  const cached = successful.get(key);
  if (cached !== undefined) return cached;
  try {
    let multiplier: number | null = null;
    if (target.exchange === "Gate.io") {
      multiplier = await getGateQuantoMultiplier(target.rawSymbol, signal);
    } else {
      const query = new URLSearchParams({ instType: "SWAP", instId: target.rawSymbol });
      const response = await okxFetch(`/api/okx?endpoint=public/instruments&${query}`, { signal });
      throwIfAborted(signal);
      if (response.ok) {
        const body = await response.json();
        const bodyObject = object(body);
        const rows = bodyObject?.data;
        const item = bodyObject?.code === "0" && Array.isArray(rows) ? rows.map(object).find(row => row?.instId === target.rawSymbol) : null;
        const ctVal = Number(item?.ctVal);
        const ctMult = item?.ctMult == null || item.ctMult === "" ? 1 : Number(item.ctMult);
        if (item?.ctType === "linear" && String(item.ctValCcy).toUpperCase() !== target.baseAsset.toUpperCase()) {
          throw new BookError("unsupported-quantity-unit", `OKX 合约数量单位不是 ${target.baseAsset}，无法安全换算`);
        }
        if (item?.ctType === "linear" && String(item.ctValCcy).toUpperCase() === target.baseAsset.toUpperCase()
          && Number.isFinite(ctVal) && ctVal > 0 && Number.isFinite(ctMult) && ctMult > 0) multiplier = ctVal * ctMult;
      }
    }
    throwIfAborted(signal);
    if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new BookError("metadata-unavailable", `无法获取 ${target.rawSymbol} 的合约数量换算信息`);
    }
    successful.set(key, multiplier);
    return multiplier;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (error instanceof BookError) throw error;
    throw new BookError("metadata-unavailable", `无法获取 ${target.rawSymbol} 的合约数量换算信息`);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
