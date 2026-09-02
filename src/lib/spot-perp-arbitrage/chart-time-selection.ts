/** An exact, inclusive candle-open-time range selected from a chart. */
import { formatChartDateTime, type ChartTimeZone } from "../chart-timezone";

export interface ChartTimeSelection {
  startTime: number;
  endTime: number;
  /** Normalized selected endpoints, retained for compatibility and rendering. */
  startIndex?: number;
  endIndex?: number;
  /** The fixed end of a keyboard-extended selection. */
  anchorIndex?: number;
  /** The movable end of a keyboard-extended selection. */
  cursorIndex?: number;
}

export interface ChartSelectionIndices {
  startIndex: number;
  endIndex: number;
  anchorIndex: number;
  cursorIndex: number;
}

export type ChartArrowDirection = "ArrowLeft" | "ArrowRight";

function validIndex(index: unknown, length: number): index is number {
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < length;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

/** Creates a range with firstIndex as its anchor and secondIndex as its cursor. */
export function chartTimeSelectionFromIndices(
  openTimes: readonly number[],
  firstIndex: number,
  secondIndex: number,
): ChartTimeSelection | null {
  if (openTimes.length === 0 || !Number.isFinite(firstIndex) || !Number.isFinite(secondIndex)) return null;
  const anchorIndex = clampIndex(Math.trunc(firstIndex), openTimes.length);
  const cursorIndex = clampIndex(Math.trunc(secondIndex), openTimes.length);
  const startIndex = Math.min(anchorIndex, cursorIndex);
  const endIndex = Math.max(anchorIndex, cursorIndex);
  const startTime = openTimes[startIndex];
  const endTime = openTimes[endIndex];
  return Number.isFinite(startTime) && Number.isFinite(endTime)
    ? { startTime, endTime, startIndex, endIndex, anchorIndex, cursorIndex }
    : null;
}

/**
 * Resolves selection endpoints against the current chart. Stored orientation is
 * restored only when its stored indices still identify the current endpoints.
 */
export function chartSelectionIndices(
  openTimes: readonly number[],
  selection: ChartTimeSelection | null | undefined,
): ChartSelectionIndices | null {
  if (!selection || openTimes.length === 0 || !Number.isFinite(selection.startTime) || !Number.isFinite(selection.endTime)) return null;

  const anchorIndex = selection.anchorIndex;
  const cursorIndex = selection.cursorIndex;
  if (validIndex(anchorIndex, openTimes.length) && validIndex(cursorIndex, openTimes.length)) {
    const startIndex = Math.min(anchorIndex, cursorIndex);
    const endIndex = Math.max(anchorIndex, cursorIndex);
    if (openTimes[startIndex] === selection.startTime && openTimes[endIndex] === selection.endTime) {
      return { startIndex, endIndex, anchorIndex, cursorIndex };
    }
  }

  const startIndex = openTimes.findIndex((time) => Number.isFinite(time) && time >= selection.startTime);
  let endIndex = -1;
  for (let index = openTimes.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(openTimes[index]) && openTimes[index] <= selection.endTime) {
      endIndex = index;
      break;
    }
  }
  return startIndex >= 0 && endIndex >= startIndex
    ? { startIndex, endIndex, anchorIndex: startIndex, cursorIndex: endIndex }
    : null;
}

/** Moves or extends a selection by one candle, preserving keyboard orientation. */
export function moveChartTimeSelection(
  openTimes: readonly number[],
  selection: ChartTimeSelection | null | undefined,
  direction: ChartArrowDirection,
  extend: boolean,
): ChartTimeSelection | null {
  if (openTimes.length === 0) return null;
  const delta = direction === "ArrowLeft" ? -1 : 1;
  const current = chartSelectionIndices(openTimes, selection);
  const cursor = current?.cursorIndex ?? openTimes.length - 1;
  const nextCursor = clampIndex(cursor + delta, openTimes.length);
  return chartTimeSelectionFromIndices(openTimes, extend ? (current?.anchorIndex ?? cursor) : nextCursor, nextCursor);
}

function hasValidBounds(selection: ChartTimeSelection): boolean {
  return Number.isFinite(selection.startTime) && Number.isFinite(selection.endTime) && selection.startTime <= selection.endTime;
}

export function filterInChartTimeSelection<T extends { openTime: number }>(
  values: readonly T[],
  selection: ChartTimeSelection | null | undefined,
): T[] {
  if (!selection) return [...values];
  if (!hasValidBounds(selection)) return [];
  return values.filter((value) => value.openTime >= selection.startTime && value.openTime <= selection.endTime);
}

export function filterTimedInChartTimeSelection<T extends { time: number }>(
  values: readonly T[],
  selection: ChartTimeSelection | null | undefined,
): T[] {
  if (!selection) return [...values];
  if (!hasValidBounds(selection)) return [];
  return values.filter((value) => value.time >= selection.startTime && value.time <= selection.endTime);
}

export function formatChartTimeSelection(selection: ChartTimeSelection, timeZone: ChartTimeZone = "UTC"): string {
  return `${formatChartDateTime(selection.startTime, timeZone)} ${timeZone} — ${formatChartDateTime(selection.endTime, timeZone)} ${timeZone}`;
}
