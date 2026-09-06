import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

export const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
] as const;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRY_AFTER_SECONDS = 60;

type FailureKind = "cancelled" | "timeout" | "transport" | "malformed" | "http";

export interface GateRouteFailure {
  ok: false;
  status: number;
  message: string;
  kind: FailureKind;
  payload?: unknown;
  retryAfter?: string;
}

export interface GateRouteSuccess<T> {
  ok: true;
  data: T;
}

export type GateRouteResult<T> = GateRouteSuccess<T> | GateRouteFailure;

export interface GateRouteRequestOptions<T> {
  path: string;
  timeout: number;
  query?: Record<string, string | undefined>;
  validate: (payload: unknown) => payload is T;
  invalidMessage: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOwnTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /(?:timed? ?out|timeout)/i.test(error.message);
}

function boundedRetryAfter(value: string | null): string | undefined {
  if (!value) return undefined;

  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return String(Math.min(Math.floor(seconds), MAX_RETRY_AFTER_SECONDS));
  }

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const delta = Math.max(0, Math.ceil((date - Date.now()) / 1_000));
    return String(Math.min(delta, MAX_RETRY_AFTER_SECONDS));
  }

  return undefined;
}

async function readJson(response: Response): Promise<{ value?: unknown; valid: boolean }> {
  try {
    return { value: await response.json(), valid: true };
  } catch {
    return { valid: false };
  }
}

function cancelled(): GateRouteFailure {
  return { ok: false, status: 499, kind: "cancelled", message: "Request cancelled" };
}

/**
 * Fetch one Gate resource, retrying only failures that are safe to try on a
 * different allowlisted origin. The proxy helper owns the request timeout;
 * using the request signal directly lets us distinguish it from cancellation.
 */
export async function fetchGateJson<T>(
  request: NextRequest,
  options: GateRouteRequestOptions<T>,
): Promise<GateRouteResult<T>> {
  let lastFailure: GateRouteFailure | undefined;

  for (const baseUrl of GATE_API_URLS) {
    if (request.signal.aborted) return cancelled();

    const url = new URL(`${baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    try {
      const response = await proxyFetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: options.timeout,
        signal: request.signal,
      });

      if (request.signal.aborted) return cancelled();

      if (response.ok) {
        const parsed = await readJson(response);
        if (request.signal.aborted) return cancelled();
        if (parsed.valid && options.validate(parsed.value)) {
          return { ok: true, data: parsed.value };
        }

        lastFailure = {
          ok: false,
          status: 502,
          kind: "malformed",
          message: parsed.valid ? options.invalidMessage : "Upstream returned invalid JSON",
        };
        continue;
      }

      const parsed = await readJson(response);
      const failure: GateRouteFailure = {
        ok: false,
        status: response.status,
        kind: "http",
        message: `HTTP ${response.status}`,
        ...(parsed.valid ? { payload: parsed.value } : {}),
        ...(response.status === 429 || response.status >= 400
          ? { retryAfter: boundedRetryAfter(response.headers.get("retry-after")) }
          : {}),
      };

      // 4xx responses, including rate limits, are definitive caller/upstream
      // responses. Never amplify them by trying another host.
      if (response.status >= 400 && response.status < 500) return failure;
      if (!RETRYABLE_STATUSES.has(response.status)) return failure;
      lastFailure = failure;
    } catch (error) {
      if (request.signal.aborted) return cancelled();

      const timeout = isOwnTimeout(error);
      lastFailure = {
        ok: false,
        status: timeout ? 504 : 502,
        kind: timeout ? "timeout" : "transport",
        message: errorMessage(error),
      };
    }
  }

  return lastFailure ?? {
    ok: false,
    status: 502,
    kind: "transport",
    message: "Failed to fetch from all Gate.io endpoints",
  };
}

export function gateFailureResponse(failure: GateRouteFailure): NextResponse {
  const headers = new Headers();
  if (failure.retryAfter !== undefined) headers.set("Retry-After", failure.retryAfter);
  return NextResponse.json(failure.payload ?? { error: failure.message }, {
    status: failure.status,
    headers,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isArrayPayload(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;

  async function runWorker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()));
  return results;
}
