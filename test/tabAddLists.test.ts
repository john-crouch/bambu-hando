// ABOUTME: Tests for the Add tab's local list and text helpers: cursor moves, type-ahead and line editing.
// ABOUTME: They mirror the design system's pure helpers, so swapping them for ui/'s keeps these cases.

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import { editText, moveCursor, typeAhead } from "../src/tui/tabs/add/lists.js";

describe("moveCursor", () => {
  it("moves one row with the arrows without wrapping", () => {
    expect(moveCursor(0, press("down"), 3, 10)).toBe(1);
    expect(moveCursor(2, press("down"), 3, 10)).toBe(2);
    expect(moveCursor(0, press("up"), 3, 10)).toBe(0);
  });

  it("moves a page, and to either end", () => {
    expect(moveCursor(0, press("pageDown"), 30, 10)).toBe(10);
    expect(moveCursor(25, press("pageDown"), 30, 10)).toBe(29);
    expect(moveCursor(5, press("pageUp"), 30, 10)).toBe(0);
    expect(moveCursor(5, press("home"), 30, 10)).toBe(0);
    expect(moveCursor(5, press("end"), 30, 10)).toBe(29);
  });

  it("returns null for keys that aren't moves, and stays at 0 in an empty list", () => {
    expect(moveCursor(0, press("a"), 3, 10)).toBeNull();
    expect(moveCursor(0, press("down"), 0, 10)).toBe(0);
  });
});

describe("typeAhead", () => {
  const labels = ["Polymaker", "Prusament", "Sunlu", "eSun"];

  it("jumps to the next label starting with the letter, ignoring case, and wraps", () => {
    expect(typeAhead(labels, 0, "p")).toBe(1);
    expect(typeAhead(labels, 1, "p")).toBe(0);
    expect(typeAhead(labels, 0, "e")).toBe(3);
  });

  it("stays put when nothing starts with the letter", () => {
    expect(typeAhead(labels, 2, "z")).toBe(2);
  });
});

describe("editText", () => {
  const at = (value: string, cursor = value.length) => ({ value, cursor });

  it("types at the cursor, including spaces and bursts, dropping line breaks", () => {
    expect(editText(at("ab", 1), press("x"))).toEqual(at("axb", 2));
    expect(editText(at("ab"), press("space"))).toEqual(at("ab "));
    expect(editText(at(""), press("red\r"))).toEqual(at("red"));
  });

  it("deletes before and after the cursor", () => {
    expect(editText(at("abc", 2), press("backspace"))).toEqual(at("ac", 1));
    expect(editText(at("abc", 0), press("backspace"))).toEqual(at("abc", 0));
    expect(editText(at("abc", 1), press("delete"))).toEqual(at("ac", 1));
  });

  it("moves the cursor with left, right, home and end", () => {
    expect(editText(at("abc"), press("left"))).toEqual(at("abc", 2));
    expect(editText(at("abc", 3), press("right"))).toEqual(at("abc", 3));
    expect(editText(at("abc"), press("home"))).toEqual(at("abc", 0));
    expect(editText(at("abc", 0), press("end"))).toEqual(at("abc", 3));
  });

  it("leaves other keys to the caller", () => {
    expect(editText(at("abc"), press("enter"))).toBeNull();
    expect(editText(at("abc"), press("a", { ctrl: true }))).toBeNull();
    expect(editText(at("abc"), press("up"))).toBeNull();
  });
});
