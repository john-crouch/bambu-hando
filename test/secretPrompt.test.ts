// ABOUTME: Tests for reading a secret without echoing it: keystroke handling and piped input.
// ABOUTME: The hidden terminal prompt itself is covered in a real PTY by the key command's e2e test.

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readPiped, type SecretEntry, secretKeys } from "../src/secretPrompt.js";

const START: SecretEntry = { value: "", done: false, cancelled: false };

describe("secretKeys", () => {
  it("collects typed characters until enter", () => {
    const typed = secretKeys(secretKeys(START, "ab"), "c\r");
    expect(typed).toEqual({ value: "abc", done: true, cancelled: false });
  });

  it("takes a pasted key in one burst", () => {
    expect(secretKeys(START, "tdfp_0123456789abcdef\r")).toEqual({
      value: "tdfp_0123456789abcdef",
      done: true,
      cancelled: false,
    });
  });

  it("accepts a newline as enter", () => {
    expect(secretKeys(START, "abc\n")).toMatchObject({ value: "abc", done: true });
  });

  it("ignores what follows enter in the same burst", () => {
    expect(secretKeys(START, "abc\rdef")).toMatchObject({ value: "abc", done: true });
  });

  it("deletes with backspace and clears with ctrl+u", () => {
    expect(secretKeys(START, "abcd\u007f\b")).toMatchObject({ value: "ab", done: false });
    expect(secretKeys(START, "abc\u0015xy")).toMatchObject({ value: "xy" });
    expect(secretKeys(START, "\u007f")).toMatchObject({ value: "" });
  });

  it("cancels on ctrl+c, and on ctrl+d with nothing typed", () => {
    expect(secretKeys(START, "ab\u0003")).toEqual({ value: "", done: false, cancelled: true });
    expect(secretKeys(START, "\u0004")).toMatchObject({ cancelled: true });
  });

  it("finishes on ctrl+d once something is typed", () => {
    expect(secretKeys(START, "abc\u0004")).toMatchObject({
      value: "abc",
      done: true,
      cancelled: false,
    });
  });

  it("drops arrow keys and other escape sequences instead of storing them", () => {
    expect(secretKeys(START, "a\u001b[Db\u001b[200~c\u001b[201~\u001bOA")).toMatchObject({
      value: "abc",
    });
  });

  it("drops other control characters", () => {
    expect(secretKeys(START, "a\tb\u0007c")).toMatchObject({ value: "abc" });
  });
});

describe("readPiped", () => {
  it("reads all of a piped stdin", async () => {
    expect(await readPiped(Readable.from(["tdfp_", "abc123\n"]))).toBe("tdfp_abc123\n");
  });
});
