// ABOUTME: Tests for keeping text from consoles and APIs from driving the terminal: escaped in headless output,
// ABOUTME: dropped from the TUI's fitted lines, with JSON still valid and its data unchanged.

import { describe, expect, it } from "vitest";

import { printableLine, printableOutput } from "../src/terminalText.js";
import { fitSegments, fitText, textWidth } from "../src/tui/ui/text.js";

describe("printableOutput", () => {
  it("shows control characters and bidi overrides as \\u escapes, keeping lines, tabs and ordinary text", () => {
    expect(printableOutput("Red\u001b[2J\r\n\tok ™ 230–250°C 🧵")).toBe(
      "Red\\u001b[2J\\u000d\n\tok ™ 230–250°C 🧵",
    );
    expect(printableOutput("a\u009b31mb‮c⁦d\u007f")).toBe("a\\u009b31mb\\u202ec\\u2066d\\u007f");
  });

  it("leaves JSON valid with the same data", () => {
    const data = { color: "x\u009by‮z\u001b", n: 1 };
    expect(JSON.parse(printableOutput(JSON.stringify(data, null, 2)))).toEqual(data);
  });
});

describe("printableLine", () => {
  it("makes one plain line: whitespace controls become spaces, the rest go", () => {
    expect(printableLine("a\tb\nc\r\u001b[31md\u009b‮e")).toBe("a b c [31mde");
  });
});

describe("the TUI's text helpers", () => {
  it("never pass an escape sequence through, and measure what's drawn", () => {
    const fitted = fitText("Red\u001b[2J\u001b]8;;http://x\u0007", 20);
    expect(/\p{Cc}/u.test(fitted)).toBe(false);
    expect(fitted).toBe("Red[2J]8;;http://x  ");
    expect(textWidth("a\u001b[31mb")).toBe(6);
    const segments = fitSegments([{ text: "x\u001b[1my" }, { text: "z" }], 10);
    expect(segments.map((s) => s.text)).toEqual(["x[1my", "z"]);
  });
});
