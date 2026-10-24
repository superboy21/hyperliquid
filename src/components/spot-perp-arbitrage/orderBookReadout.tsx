"use client";

import type { ReactNode } from "react";
import type { CombinationBookMetrics, CombinationBookSpreadMetric } from "@/lib/order-book/combination";

/**
 * Shared readout primitives for the two order-book panels.
 *
 * Both the combined book and a single market render the same compact line
 * (`label + signed value + percent`), so the formatting and the markup live
 * here instead of being duplicated. Nothing in this module imports either
 * panel: `LiveOrderBookPanel` exports `bookSourceLabel`, which
 * `CombinationOrderBookPanel` consumes, so a back-import here would create a
 * cycle.
 */

/**
 * USDT notionals: never round a positive amount to 0.00, never show size with
 * false precision. Amounts under 0.01 keep four significant digits.
 */
export function formatUsdt(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  if (size > 0 && size < 0.01) {
    return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Signed buy−sell reading.
 *
 * This deliberately does not reuse a ratio/price formatter: those pin four
 * decimals in the common band, so a 0.0000002 gap would print as "0.0000" and
 * the row would claim the two sides are equal. Magnitude-based significant
 * digits keep a genuinely tiny gap visible, an explicit "+" makes the sign
 * unmistakable, and zero is a plain "0" (never "-0"). Non-finite input stays a
 * dash so no NaN or Infinity leaks into the number cell.
 */
export function formatMetricDifference(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const size = Math.abs(value);
  const body = size >= 1000
    ? size.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : size.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  return `${value > 0 ? "+" : "-"}${body}`;
}

/**
 * Percentage formatter for the same reading. `null` means "no usable midpoint"
 * (the finite difference is still worth showing) and renders as a dash. Small
 * percentages keep five significant digits so a 0.004% gap cannot round to
 * 0.00%; huge ones drop the decimals to stay inside the row.
 */
export function formatMetricPercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "—";
  if (percent === 0) return "0%";
  const size = Math.abs(percent);
  const body = size >= 1000
    ? size.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : size.toLocaleString("en-US", { maximumSignificantDigits: 5 });
  return `${percent > 0 ? "+" : "-"}${body}%`;
}

/** One-line explanation for a missing reading; the full sentence stays on hover. */
export function shortMetricReason(reason: string | null, maxLength = 34): string | null {
  if (reason === null) return null;
  const text = reason.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Both readings collapse to the same sentence when the whole book is unusable.
 * Printing it twice side by side would read like a rendering bug, so each row
 * shows it once.
 */
export function sharedMetricReason(metrics: CombinationBookMetrics): string | null {
  return metrics.best === null
    && metrics.vwap === null
    && metrics.bestReason !== null
    && metrics.bestReason === metrics.vwapReason
    ? metrics.bestReason
    : null;
}

/**
 * The leg metrics helper is labelled A/B because it serves the two legs of a
 * pair. A single-market panel is not a leg, so it strips that prefix from the
 * reason text while keeping the sentence itself untouched.
 */
export function stripLegPrefix(reason: string | null): string | null {
  if (reason === null) return null;
  const text = reason
    .replace(/A 腿[：:]\s*/g, "")
    .replace(/A 腿\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length === 0 ? reason : text;
}

/** `HH:MM:SS` in the dashboard's fixed locale. */
export function formatClockTime(value: number): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

/**
 * Accent tokens for the two readings. Only the label colour remains: the rows
 * are single-line, so there is no card chrome left to tint.
 */
const METRIC_ACCENTS = {
  sky: { label: "text-sky-200" },
  violet: { label: "text-violet-200" },
} as const;

/**
 * One reading on a single line: label, signed absolute value, percent, and
 * (when the reading is missing) a truncated cause. All three text roles share
 * `text-[10px]`; only colour and weight distinguish them, and `leading-5` keeps
 * the previous line box.
 *
 * The value span carries a data attribute because the SSR/e2e checks need the
 * exact rendered number without depending on class order; the visible copy
 * stays fully human.
 */
export function SpreadMetricInline(props: {
  kind: "best" | "vwap";
  label: string;
  accent: keyof typeof METRIC_ACCENTS;
  metric: CombinationBookSpreadMetric | null;
  reason: string | null;
  /** Full calculation note, also used as the label's hover text. */
  title: string;
  /** Why the percentage alone can be missing while the difference stands. */
  percentNullTitle: string;
  /**
   * Narrows the accessible name and data hook to one owner (leg A, leg B, or a
   * single market). The pair summary leaves it out.
   */
  scope?: { hook: string; label: string };
}) {
  const { kind, label, accent, metric, reason, title, percentNullTitle, scope } = props;
  const tone = METRIC_ACCENTS[accent];
  const available = metric !== null;
  const difference = available ? formatMetricDifference(metric.difference) : "—";
  const percent = available ? formatMetricPercent(metric.percent) : "—";
  const reasonText = shortMetricReason(reason, 30);
  const hook = `${scope ? `${scope.hook}-` : ""}${kind}`;
  // Only a genuinely withheld percentage explains why it is missing; a finite
  // one must show the calculation note instead of claiming it cannot be computed.
  const percentTitle = !available
    ? "当前没有可发布的点差，因此不显示百分比"
    : metric.percent === null
      ? percentNullTitle
      : title;

  return (
    <span
      role="group"
      aria-label={`${scope?.label ?? label}指标`}
      className="inline-flex min-w-0 items-baseline gap-1.5 whitespace-nowrap"
    >
      <span className={`text-[10px] font-semibold ${tone.label}`} title={title}>{label}</span>
      <span
        data-combination-metric={`${hook}-difference`}
        title={available ? title : "当前没有可发布的点差"}
        className={`text-[10px] font-semibold leading-5 tabular-nums ${available ? "text-gray-100" : "text-gray-500"}`}
      >
        {difference}
      </span>
      {available && metric.percent === null && (
        // Naming the dash keeps it from reading as "the spread is missing".
        <span className="text-[10px] text-gray-500" title={percentTitle}>百分比</span>
      )}
      {available && (
        <span
          data-combination-metric={`${hook}-percent`}
          title={percentTitle}
          className={`text-[10px] tabular-nums ${metric.percent === null ? "text-gray-500" : "text-gray-400"}`}
        >
          {percent}
        </span>
      )}
      {reasonText && (
        <span className="max-w-[14rem] truncate text-[10px] text-gray-500" title={reason ?? undefined}>
          {reasonText}
        </span>
      )}
    </span>
  );
}

/**
 * The single-line strip wrapping two readings. Content is `min-w-max` inside an
 * `overflow-x-auto` box: on a wide column the readings sit side by side, and in
 * a narrow container the strip scrolls locally instead of clipping the numbers
 * or widening the page.
 */
export function SpreadSummaryStrip(props: { label: string; children: ReactNode; sharedReason: string | null }) {
  const { label, children, sharedReason } = props;
  return (
    <div
      role="group"
      aria-label={label}
      className="min-w-0 overflow-x-auto rounded border border-gray-700/70 bg-gray-950/40 px-1.5 py-1 [scrollbar-color:#4b5563_transparent] [scrollbar-width:thin]"
    >
      <div className="flex min-w-max items-baseline gap-x-2 whitespace-nowrap">
        {children}
        {sharedReason !== null && (
          <span className="max-w-[16rem] truncate text-[10px] text-gray-500" title={sharedReason}>
            {shortMetricReason(sharedReason, 46)}
          </span>
        )}
      </div>
    </div>
  );
}
