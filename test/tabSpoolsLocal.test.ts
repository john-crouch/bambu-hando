// ABOUTME: Tests for the Spools tab's small list and text helpers: cursor moves, type-ahead and line editing.
// ABOUTME: They stand in for the design system's helpers until those are merged, so their edge cases are pinned here.

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import { editText, moveCursor, textState, typeAhead } from "../src/tui/tabs/spools/local.js";

describe("moveCursor", () => {
  it("moves by one, a page, or to either end, without wrapping", () => {
    expect(moveCursor(0, press("down"), 5, 3)).toBe(1);
    expect(moveCursor(4, press("down"), 5, 3)).toBe(4);
    expect(moveCursor(0, press("up"), 5, 3)).toBe(0);
    expect(moveCursor(1, press("pageDown"), 5, 3)).toBe(4);
    expect(moveCursor(4, press("pageUp"), 5, 3)).toBe(1);
    expect(moveCursor(2, press("home"), 5, 3)).toBe(0);
    expect(moveCursor(2, press("end"), 5, 3)).toBe(4);
  });

  it("returns null for keys that don't move, and stays at 0 in an empty list", () => {
    expect(moveCursor(0, press("x"), 5, 3)).toBeNull();
    expect(moveCursor(0, press("down"), 0, 3)).toBe(0);
  });
});

describe("typeAhead", () => {
  const labels = ["Acme PLA", "Beta PETG", "Acme PETG", "Zeta ABS"];

  it("jumps to the next label starting with the letter, after the cursor, wrapping", () => {
    expect(typeAhead(labels, 0, "a")).toBe(2);
    expect(typeAhead(labels, 2, "a")).toBe(0);
    expect(typeAhead(labels, 0, "Z")).toBe(3);
  });

  it("stays put when nothing starts with it", () => {
    expect(typeAhead(labels, 1, "q")).toBe(1);
  });
});

describe("editText", () => {
  it("types at the cursor, deletes either side, and moves", () => {
    let state = textState("ac");
    state = editText(state, press("left")) ?? state;
    state = editText(state, press("b")) ?? state;
    expect(state).toEqual({ value: "abc", cursor: 2 });
    state = editText(state, press("backspace")) ?? state;
    expect(state).toEqual({ value: "ac", cursor: 1 });
    state = editText(state, press("delete")) ?? state;
    expect(state).toEqual({ value: "a", cursor: 1 });
    state = editText(state, press("home")) ?? state;
    expect(state.cursor).toBe(0);
    state = editText(state, press("end")) ?? state;
    expect(state.cursor).toBe(1);
  });

  it("types a space and a burst whole, and ? and q like any letter", () => {
    let state = textState("");
    for (const key of [press("?"), press("space"), press("q"), press("0015")])
      state = editText(state, key) ?? state;
    expect(state).toEqual({ value: "? q0015", cursor: 7 });
  });

  it("drops the line breaks of a pasted burst", () => {
    expect(editText(textState(""), press("ab\r\n"))).toEqual({ value: "ab", cursor: 2 });
  });

  it("returns null for keys that aren't editing (enter, esc, arrows up and down, ctrl)", () => {
    for (const key of [press("enter"), press("esc"), press("up"), press("a", { ctrl: true })])
      expect(editText(textState("x"), key)).toBeNull();
  });
});
