// ABOUTME: Tests the TUI's @inkjs/ui theme: status icons, badges that fit a fixed column, the spinner frame.
// ABOUTME: Renders the library components inside the project's ThemeProvider with ink-testing-library.

import { Badge, Spinner, StatusMessage, ThemeProvider } from "@inkjs/ui";
import { Box } from "ink";
import { render } from "ink-testing-library";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { theme } from "../src/tui/theme.js";

const themed = (node: ReactNode) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

describe("theme", () => {
  it("marks status messages with the TUI's own one-column icons", () => {
    const { lastFrame } = themed(
      <Box flexDirection="column">
        <StatusMessage variant="success">saved</StatusMessage>
        <StatusMessage variant="error">rejected</StatusMessage>
        <StatusMessage variant="warning">careful</StatusMessage>
      </Box>,
    );

    expect(lastFrame()).toBe("✓ saved\n✗ rejected\n! careful");
  });

  it("wraps a long status message under its text, not under the icon", () => {
    const { lastFrame } = themed(
      <Box width={20}>
        <StatusMessage variant="warning">one two three fourth five</StatusMessage>
      </Box>,
    );

    const [first, second] = (lastFrame() ?? "").split("\n");
    expect(first).toBe("! one two three");
    expect(second).toBe("  fourth five");
  });

  it("cuts a badge that doesn't fit its column instead of wrapping it", () => {
    const { lastFrame } = themed(
      <Box width={6} flexShrink={0}>
        <Badge color="green">written</Badge>
      </Box>,
    );

    expect(lastFrame()).toBe(" WRIT…");
  });

  it("turns the spinner through one-column braille dots", () => {
    const { lastFrame } = themed(<Spinner label="working" />);

    expect(lastFrame()).toBe("⠋ working");
  });
});
