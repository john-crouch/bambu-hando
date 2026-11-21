// ABOUTME: Tests for the Presets tab's local list and text helpers: cursor moves, type-ahead, word filters, text editing.
// ABOUTME: Pure functions driven with press() keys, as the tab's update calls them.

import { describe, expect, it } from "vitest";
import { press } from "../src/tui/core/keys.js";
import {
  editText,
  matchesWords,
  moveCursor,
  type TextState,
  typeAhead,
} from "../src/tui/tabs/presets/helpers.js";

describe("moveCursor", () => {
  it("moves with arrows, pages and home/end, without wrapping", () => {
    expect(moveCursor(0, press("down"), 5, 3)).toBe(1);
    expect(moveCursor(4, press("down"), 5, 3)).toBe(4);
    expect(moveCursor(0, press("up"), 5, 3)).toBe(0);
    expect(moveCursor(0, press("pageDown"), 5, 3)).toBe(3);
    expect(moveCursor(3, press("pageDown"), 5, 3)).toBe(4);
    expect(moveCursor(4, press("pageUp"), 5, 3)).toBe(1);
    expect(moveCursor(2, press("home"), 5, 3)).toBe(0);
    expect(moveCursor(2, press("end"), 5, 3)).toBe(4);
  });

  it("returns null for keys that don't move, and stays at 0 in an empty list", () => {
    expect(moveCursor(0, press("enter"), 5, 3)).toBeNull();
    expect(moveCursor(0, press("x"), 5, 3)).toBeNull();
    expect(moveCursor(0, press("down"), 0, 3)).toBe(0);
  });
});

describe("typeAhead", () => {
  const labels = ["Acme PLA", "Bolt PETG", "Acme PETG", "Cobalt ABS"];

  it("jumps to the next label starting with the letter, wrapping, ignoring case", () => {
    expect(typeAhead(labels, 0, "a")).toBe(2);
    expect(typeAhead(labels, 2, "a")).toBe(0);
    expect(typeAhead(labels, 0, "C")).toBe(3);
  });

  it("stays when nothing starts with the letter", () => {
    expect(typeAhead(labels, 1, "z")).toBe(1);
  });
});

describe("matchesWords", () => {
  it("needs every word of the filter, in any order, ignoring case", () => {
    expect(matchesWords("Acme PLA Basic Red X1 Carbon", "red acme")).toBe(true);
    expect(matchesWords("Acme PLA Basic Red", "red blue")).toBe(false);
    expect(matchesWords("anything", "  ")).toBe(true);
  });

  it("splits on the separators it's given", () => {
    expect(matchesWords("nozzle_temperature_range_low", "range_low", /[\s_]+/)).toBe(true);
    expect(matchesWords("nozzle_temperature", "range", /[\s_]+/)).toBe(false);
  });
});

describe("editText", () => {
  const at = (value: string, cursor = value.length): TextState => ({ value, cursor });

  it("types at the cursor, deletes on both sides and moves", () => {
    expect(editText(at("22"), press("5"))).toEqual({ state: at("225") });
    expect(editText(at("225", 1), press("1"))).toEqual({ state: at("2125", 2) });
    expect(editText(at("225"), press("backspace"))).toEqual({ state: at("22") });
    expect(editText(at("225", 1), press("delete"))).toEqual({ state: at("25", 1) });
    expect(editText(at("225"), press("left"))).toEqual({ state: at("225", 2) });
    expect(editText(at("225", 0), press("left"))).toEqual({ state: at("225", 0) });
    expect(editText(at("225", 3), press("right"))).toEqual({ state: at("225", 3) });
    expect(editText(at("225", 2), press("home"))).toEqual({ state: at("225", 0) });
    expect(editText(at("225", 0), press("end"))).toEqual({ state: at("225", 3) });
    expect(editText(at("a"), press("space"))).toEqual({ state: at("a ") });
    expect(editText(at("", 0), press("?"))).toEqual({ state: at("?") });
  });

  it("takes a burst whole, and a burst ending in a newline as typed then entered", () => {
    expect(editText(at(""), press("230"))).toEqual({ state: at("230") });
    expect(editText(at("x"), press("230\r"))).toEqual({ state: at("x230"), enter: true });
    expect(editText(at(""), press("1\nrest"))).toEqual({ state: at("1"), enter: true });
  });

  it("leaves keys it doesn't edit with to the caller", () => {
    expect(editText(at("a"), press("enter"))).toBeNull();
    expect(editText(at("a"), press("esc"))).toBeNull();
    expect(editText(at("a"), press("up"))).toBeNull();
    expect(editText(at("a"), press("u", { ctrl: true }))).toBeNull();
  });
});
