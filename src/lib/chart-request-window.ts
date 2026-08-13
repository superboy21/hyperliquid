export interface ChartRequestWindow {
  readonly endTime: number;
  readonly startTime?: number;
}

/** Captures one immutable transport window for a chart generation. */
export function createChartRequestWindow<R extends string>(
  range: R,
  durations: Readonly<Record<R, number | null>>,
  endTime: number,
): ChartRequestWindow {
  const duration = durations[range];
  return Object.freeze(duration === null ? { endTime } : { startTime: endTime - duration, endTime });
}
