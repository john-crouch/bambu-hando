// ABOUTME: Tests for the helpers the Spools tab and the labels overlay share: a text field's start and a paste.
// ABOUTME: A field starts with its cursor at the end; a paste is a typed burst, never a named key.

import { describe, expect, it } from "vitest";

import { pasted, textState } from "../src/tui/tabs/spools/local.js";

describe("textState", () => {
  it("holds the value with the cursor at its end", () => {
    expect(textState("~/labels.pdf")).toEqual({ value: "~/labels.pdf", cursor: 12 });
    expect(textState("")).toEqual({ value: "", cursor: 0 });
  });
});

describe("pasted", () => {
  it("is typed text, so pasting a key's name types it", () => {
    expect(pasted("up")).toEqual({ input: "up", ctrl: false, shift: false, meta: false });
  });
});
