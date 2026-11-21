// ABOUTME: Tests fitting table columns to the terminal's width: whole columns taken from the shrinkable ones in order.
// ABOUTME: Covers the pure fitColumns and the useTerminalColumns hook that reads the width.

import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import { fitColumns, useTerminalColumns } from "../src/tui/screenSize.js";

const WIDTHS = { swatch: 3, name: 22, brand: 12, code: 9 } as const;
const SHRINK = [
  ["name", 10],
  ["brand", 4],
] as const;

describe("fitColumns", () => {
  it("keeps every width when the table fits", () => {
    expect(fitColumns(WIDTHS, 46, SHRINK)).toEqual(WIDTHS);
    expect(fitColumns(WIDTHS, 120, SHRINK)).toEqual(WIDTHS);
  });

  it("keeps every width when the terminal's width is unknown", () => {
    expect(fitColumns(WIDTHS, undefined, SHRINK)).toEqual(WIDTHS);
  });

  it("takes the columns over the width from the first shrinkable column first", () => {
    expect(fitColumns(WIDTHS, 40, SHRINK)).toEqual({ ...WIDTHS, name: 16 });
  });

  it("goes on to the next one once the first is down to its minimum", () => {
    expect(fitColumns(WIDTHS, 30, SHRINK)).toEqual({ ...WIDTHS, name: 10, brand: 8 });
  });

  it("stops at every minimum, even if the table still doesn't fit", () => {
    expect(fitColumns(WIDTHS, 10, SHRINK)).toEqual({ ...WIDTHS, name: 10, brand: 4 });
  });

  it("never gives a column more than its own width or a fraction of a column", () => {
    const fitted = fitColumns(WIDTHS, 33.7, SHRINK);
    expect(Object.values(fitted).every(Number.isInteger)).toBe(true);
    expect(fitted.name).toBe(10);
    expect(fitted.brand).toBe(11);
  });
});

function Width() {
  return <Text>{String(useTerminalColumns())}</Text>;
}

describe("useTerminalColumns", () => {
  it("reads the terminal's width in columns", () => {
    // ink-testing-library's stdout is 100 columns wide.
    expect(render(<Width />).lastFrame()).toBe("100");
  });
});
