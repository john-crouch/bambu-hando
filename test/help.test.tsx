// ABOUTME: Tests for the TUI's help page: what each screen's page lists, and the rows where ? types instead.
// ABOUTME: Pages are pure data; the typing checks are pure functions of each form's state.

import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import { colorFormTyping, HEX_ROW, initialColorForm, NAME_ROW } from "../src/tui/ColorForm.js";
import { HELP_TOPICS, Help, helpPage } from "../src/tui/Help.js";
import { initialLabelForm, labelFormTyping, OUTPUT_ROW, SIZE_ROW } from "../src/tui/LabelForm.js";
import { formTyping } from "../src/tui/SetupForm.js";

describe("helpPage", () => {
  it("has a page for every screen, each saying how to leave it", () => {
    for (const topic of HELP_TOPICS) {
      const page = helpPage(topic);
      expect(page.title, topic).not.toBe("");
      expect(page.keys.length, topic).toBeGreaterThan(0);
      expect(
        page.keys.some(([keys]) => /esc|\[b\]|\[m\]|\[q\]|ctrl\+c/.test(keys)),
        topic,
      ).toBe(true);
    }
  });

  it("lists the keys the hint lines leave out: type-ahead, paging, select all", () => {
    const keysOf = (topic: (typeof HELP_TOPICS)[number], multi = false) =>
      helpPage(topic, multi)
        .keys.map(([keys]) => keys)
        .join(" ");
    expect(keysOf("choose")).toMatch(/letters/);
    expect(keysOf("choose")).toMatch(/pgup\/pgdn/);
    expect(keysOf("choose")).not.toMatch(/space/);
    expect(keysOf("choose", true)).toMatch(/space/);
    expect(keysOf("browse")).toMatch(/ctrl\+a/);
    expect(keysOf("pick")).toMatch(/ctrl\+a/);
    expect(keysOf("check")).toMatch(/pgup\/pgdn/);
  });

  it("fits every line in an 80-column terminal", () => {
    for (const topic of HELP_TOPICS) {
      for (const multi of [false, true]) {
        const page = helpPage(topic, multi);
        expect(page.about.length, page.about).toBeLessThanOrEqual(79);
        const keysWidth = 2 + Math.max(...page.keys.map(([keys]) => keys.length)) + 2;
        for (const [keys, what] of page.keys)
          expect(keysWidth + what.length, `${topic}: ${keys}`).toBeLessThanOrEqual(79);
      }
    }
  });

  it("renders the page with any key going back", () => {
    const { lastFrame } = render(<Help topic="plan" />);
    expect(lastFrame()).toContain("Help: the plan");
    expect(lastFrame()).toMatch(/\[a\] +write the presets/);
    expect(lastFrame()).toContain("any key goes back");
  });
});

describe("rows where ? types instead of opening help", () => {
  it("is the color name, not the hex color or the other rows", () => {
    expect(colorFormTyping({ ...initialColorForm(), cursor: NAME_ROW })).toBe(true);
    expect(colorFormTyping({ ...initialColorForm(), cursor: HEX_ROW })).toBe(false);
  });

  it("is the label PDF path, not the size", () => {
    const form = initialLabelForm({ fields: [], size: "57x32mm", printer: "", output: "" }, []);
    expect(labelFormTyping({ ...form, cursor: OUTPUT_ROW })).toBe(true);
    expect(labelFormTyping({ ...form, cursor: SIZE_ROW })).toBe(false);
  });

  it("is a text field in the settings, not a toggle or a list", () => {
    // Rows: import file, preset folder, printers, overwrite, skip SpoolEase, create spools, console, host…
    expect(formTyping(true, 0)).toBe(true);
    expect(formTyping(true, 1)).toBe(false);
    expect(formTyping(true, 3)).toBe(false);
    expect(formTyping(true, 7)).toBe(true);
    expect(formTyping(false, 7)).toBe(false);
  });
});
