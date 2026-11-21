// ABOUTME: Tests editText, the pure line editor behind every text field: typing, bursts, deletes, cursor moves.
// ABOUTME: Also fieldView, which picks the part of a long value to show so the cursor stays in sight.

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import { textWidth } from "../src/tui/ui/text.js";
import { editText, fieldView } from "../src/tui/ui/textField.js";

const at = (value: string, cursor = value.length) => ({ value, cursor });

describe("editText", () => {
  it("types at the cursor", () => {
    expect(editText(at(""), press("a"))).toEqual({ value: "a", cursor: 1 });
    expect(editText(at("PTG", 1), press("E"))).toEqual({ value: "PETG", cursor: 2 });
    expect(editText(at("PLA"), press("space"))).toEqual({ value: "PLA ", cursor: 4 });
  });

  it("types a burst whole, and reports a burst ending in enter as submitted", () => {
    expect(editText(at("x"), press("abc"))).toEqual({ value: "xabc", cursor: 4 });
    expect(editText(at(""), press("00150603Z\r"))).toEqual({
      value: "00150603Z",
      cursor: 9,
      submit: true,
    });
    expect(editText(at(""), press("12\n34"))).toEqual({ value: "12", cursor: 2, submit: true });
  });

  it("drops control characters from typed text", () => {
    expect(editText(at(""), press("a\tb\u0007c"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("deletes before the cursor with backspace and after it with delete", () => {
    expect(editText(at("PETG"), press("backspace"))).toEqual({ value: "PET", cursor: 3 });
    expect(editText(at("PETG", 2), press("backspace"))).toEqual({ value: "PTG", cursor: 1 });
    expect(editText(at("PETG", 0), press("backspace"))).toEqual({ value: "PETG", cursor: 0 });
    expect(editText(at("PETG", 1), press("delete"))).toEqual({ value: "PTG", cursor: 1 });
    expect(editText(at("PETG"), press("delete"))).toEqual({ value: "PETG", cursor: 4 });
  });

  it("deletes the word before the cursor with ctrl+w or alt+backspace, and the line start with ctrl+u", () => {
    expect(editText(at("Sunlu PETG  "), press("w", { ctrl: true }))).toEqual({
      value: "Sunlu ",
      cursor: 6,
    });
    expect(editText(at("Sunlu PETG"), press("backspace", { meta: true }))).toEqual({
      value: "Sunlu ",
      cursor: 6,
    });
    expect(editText(at("Sunlu PETG", 6), press("u", { ctrl: true }))).toEqual({
      value: "PETG",
      cursor: 0,
    });
  });

  it("moves with ←/→, home/end and ctrl+a/ctrl+e, staying inside the text", () => {
    expect(editText(at("PETG", 2), press("left"))).toEqual({ value: "PETG", cursor: 1 });
    expect(editText(at("PETG", 0), press("left"))).toEqual({ value: "PETG", cursor: 0 });
    expect(editText(at("PETG", 2), press("right"))).toEqual({ value: "PETG", cursor: 3 });
    expect(editText(at("PETG"), press("right"))).toEqual({ value: "PETG", cursor: 4 });
    expect(editText(at("PETG", 2), press("home"))).toEqual({ value: "PETG", cursor: 0 });
    expect(editText(at("PETG", 2), press("end"))).toEqual({ value: "PETG", cursor: 4 });
    expect(editText(at("PETG", 2), press("a", { ctrl: true }))).toEqual({
      value: "PETG",
      cursor: 0,
    });
    expect(editText(at("PETG", 2), press("e", { ctrl: true }))).toEqual({
      value: "PETG",
      cursor: 4,
    });
  });

  it("jumps words with alt or ctrl and the arrows", () => {
    expect(editText(at("Sunlu PETG Yellow"), press("left", { meta: true }))?.cursor).toBe(11);
    expect(editText(at("Sunlu PETG Yellow", 11), press("left", { ctrl: true }))?.cursor).toBe(6);
    expect(editText(at("Sunlu PETG Yellow", 0), press("right", { meta: true }))?.cursor).toBe(5);
    expect(editText(at("Sunlu PETG Yellow", 5), press("right", { meta: true }))?.cursor).toBe(10);
  });

  it("steps over whole characters, emoji and accents included", () => {
    const flag = "a🇮🇹b";
    expect(editText(at(flag, 1), press("right"))?.cursor).toBe(5);
    expect(editText(at(flag, 5), press("backspace"))).toEqual({ value: "ab", cursor: 1 });
    const accent = "café";
    expect(editText(at(accent), press("backspace"))).toEqual({ value: "caf", cursor: 3 });
  });

  it("clamps a cursor that's out of range before editing", () => {
    expect(editText({ value: "ab", cursor: 9 }, press("c"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("leaves keys that aren't editing to the caller", () => {
    for (const key of [
      press("enter"),
      press("esc"),
      press("tab"),
      press("up"),
      press("down"),
      press("k", { ctrl: true }),
    ]) {
      expect(editText(at("PETG"), key)).toBeUndefined();
    }
  });
});

describe("fieldView", () => {
  it("shows a short value whole, the cursor on the character under it or after the end", () => {
    expect(fieldView("PETG", 4, 10)).toEqual({
      before: "PETG",
      at: " ",
      after: "",
      left: false,
      right: false,
    });
    expect(fieldView("PETG", 1, 10)).toEqual({
      before: "P",
      at: "E",
      after: "TG",
      left: false,
      right: false,
    });
  });

  it("scrolls a long value so the cursor stays in sight, marking the hidden sides", () => {
    const view = fieldView("abcdefghijklmnop", 16, 8);
    expect(view).toEqual({ before: "klmnop", at: " ", after: "", left: true, right: false });
    const start = fieldView("abcdefghijklmnop", 0, 8);
    expect(start).toEqual({ before: "", at: "a", after: "bcdefg", left: false, right: true });
  });

  it("masks every character with the mask, cursor included", () => {
    expect(fieldView("secret", 6, 10, "•")).toEqual({
      before: "••••••",
      at: " ",
      after: "",
      left: false,
      right: false,
    });
  });

  it("never needs more columns than the width, markers included", () => {
    const value = "Sunlu PETG 2.0 Vivid Yellow 日本";
    for (let width = 1; width < 20; width++) {
      for (let cursor = 0; cursor <= value.length; cursor++) {
        const v = fieldView(value, cursor, width);
        const used = textWidth(v.before + v.at + v.after) + (v.left ? 1 : 0) + (v.right ? 1 : 0);
        expect(used, `width ${width} cursor ${cursor}`).toBeLessThanOrEqual(
          Math.max(width, textWidth(v.at)),
        );
      }
    }
  });
});
