import { describe, expect, test } from "bun:test";
import { normalizeProxyHeaders } from "./proxy";

describe("proxy header normalization", () => {
  test("adds exactly one lowercase Content-Type and Accept default", () => {
    const headers = normalizeProxyHeaders({ "X-Test": "value" });
    expect(headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "x-test": "value",
    });
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "content-type")).toHaveLength(1);
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "accept")).toHaveLength(1);
  });

  test("preserves caller values regardless of input header casing", () => {
    const headers = normalizeProxyHeaders({
      "Content-Type": "application/problem+json",
      ACCEPT: "application/vnd.test+json",
    });
    expect(headers["content-type"]).toBe("application/problem+json");
    expect(headers.accept).toBe("application/vnd.test+json");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Accept).toBeUndefined();
  });

  test("collapses differently-cased duplicates into one serialized header name", () => {
    const headers = normalizeProxyHeaders([
      ["content-type", "application/json"],
      ["Content-Type", "application/json"],
      ["accept", "application/json"],
      ["Accept", "application/json"],
    ]);
    expect(Object.keys(headers)).toEqual(["accept", "content-type"]);
  });
});
