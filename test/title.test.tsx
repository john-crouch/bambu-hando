// ABOUTME: Tests the TUI title: same text and width as the plain bold line, drawn bold in a pink-to-purple gradient.
// ABOUTME: Colors are forced on (FORCE_COLOR=3) so the gradient's escape codes reach the frame.

import { stripVTControlCharacters } from "node:util";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import { TITLE, Title } from "../src/tui/Title.js";

/** A 24-bit foreground color escape: ESC [ 38;2;r;g;b m. */
const TRUECOLOR = new RegExp(`${String.fromCharCode(27)}\\[38;2;(\\d+);(\\d+);(\\d+)m`, "g");

describe("Title", () => {
  it("shows the app title unchanged", () => {
    expect(TITLE).toBe("bambu-hando: sync filament profiles to BambuStudio and SpoolEase");
    const { lastFrame } = render(<Title />);
    expect(stripVTControlCharacters(lastFrame() ?? "")).toBe(TITLE);
  });

  it("is bold and fades from pink to purple", () => {
    const { lastFrame } = render(<Title />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("\u001B[1m");
    const colors = [...frame.matchAll(TRUECOLOR)].map((m) => m.slice(1, 4).map(Number));
    expect(new Set(colors.map((c) => c.join(","))).size).toBeGreaterThan(5);
    expect(colors[0]).toEqual([255, 95, 135]);
    expect(colors.at(-1)).toEqual([160, 107, 255]);
  });
});
