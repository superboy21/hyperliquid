import { expect, test } from "bun:test";
import { BookError, type BookSocketFactory } from "./types";

test("BookError retains its machine-readable failure code", () => {
  const error = new BookError("sequence-gap", "Missing update");
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("BookError");
  expect(error.code).toBe("sequence-gap");
  expect(error.message).toBe("Missing update");
});

test("the socket factory contract accepts native WebSocket without constructing one", () => {
  const factory: BookSocketFactory = (url) => new WebSocket(url);
  expect(typeof factory).toBe("function");
});
