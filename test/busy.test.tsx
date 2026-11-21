// ABOUTME: Tests the TUI's busy indicator: a spinner that turns beside a message while bambu-hando waits.
// ABOUTME: Rendered with ink-testing-library and real timers.

import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import { Busy } from "../src/tui/Busy.js";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("Busy", () => {
  it("shows the message after a one-column spinner frame, and turns", async () => {
    const { lastFrame, unmount } = render(<Busy message="Reading spools from SpoolEase…" />);
    const first = lastFrame() ?? "";

    expect(first).toBe("⠋ Reading spools from SpoolEase…");
    await wait(250);
    expect(lastFrame()).not.toBe(first);
    expect(lastFrame()).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Reading spools from SpoolEase…$/);
    unmount();
  });

  it("keeps the message beside the spinner when given a color", () => {
    const { lastFrame, unmount } = render(<Busy color="cyan" message="Writing presets…" />);

    expect(lastFrame()).toBe("⠋ Writing presets…");
    unmount();
  });
});
