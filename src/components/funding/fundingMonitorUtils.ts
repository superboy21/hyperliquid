export interface AnnualizableFundingRate {
  fundingRate: number;
  fundingInterval: number;
  notionalValue: number;
}

export type AnnualizeFundingRate = (rate: number, fundingIntervalSeconds: number) => number;

/** Returns an annualized percentage (for example, 10 means 10%). */
export function defaultAnnualizeFundingRate(rate: number, fundingIntervalSeconds: number): number {
  if (!Number.isFinite(fundingIntervalSeconds) || fundingIntervalSeconds <= 0) return 0;
  return rate * ((24 * 3600) / fundingIntervalSeconds) * 365 * 100;
}

export function calculateNotionalWeightedAnnualizedRate(
  rates: AnnualizableFundingRate[],
  annualize: AnnualizeFundingRate = defaultAnnualizeFundingRate,
): number {
  const validRates = rates.filter((rate) => Number.isFinite(rate.notionalValue) && rate.notionalValue > 0);
  const totalNotional = validRates.reduce((sum, rate) => sum + rate.notionalValue, 0);
  if (totalNotional === 0) return 0;

  return validRates.reduce(
    (sum, rate) => sum + annualize(rate.fundingRate, rate.fundingInterval) * rate.notionalValue,
    0,
  ) / totalNotional;
}

export function formatAnnualizedPercentage(annualizedPercentage: number): string {
  const absRate = Math.abs(annualizedPercentage);
  if (absRate >= 100) return `${annualizedPercentage > 0 ? "+" : ""}${annualizedPercentage.toFixed(1)}%`;
  if (absRate >= 10) return `${annualizedPercentage > 0 ? "+" : ""}${annualizedPercentage.toFixed(2)}%`;
  return `${annualizedPercentage > 0 ? "+" : ""}${annualizedPercentage.toFixed(3)}%`;
}

export function computeValidBboSpread(bestBid?: number, bestAsk?: number): number | null {
  if (
    !Number.isFinite(bestBid)
    || !Number.isFinite(bestAsk)
    || (bestBid as number) <= 0
    || (bestAsk as number) < (bestBid as number)
  ) {
    return null;
  }

  const midpoint = ((bestBid as number) + (bestAsk as number)) / 2;
  return midpoint > 0 ? (((bestAsk as number) - (bestBid as number)) / midpoint) * 100 : null;
}

export function resolveTopBboSpread(
  currentRow: { bestBid?: number; bestAsk?: number } | undefined,
  detailSpread: number | null,
): number | null {
  const currentSpread = computeValidBboSpread(currentRow?.bestBid, currentRow?.bestAsk);
  if (currentSpread !== null) return currentSpread;
  return Number.isFinite(detailSpread) && (detailSpread as number) >= 0 ? detailSpread : null;
}
