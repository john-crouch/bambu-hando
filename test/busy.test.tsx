// ABOUTME: Tests the TUI's busy indicator: a spinner that turns beside a message while bambu-hando waits.
// ABOUTME: Rendered with ink-testing-library and real timers.

import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import { Busy, SPINNER_FRAMES } from "../src/tui/Busy.js";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("Busy", () => {
  it("shows the message after a spinner frame, and turns", async () => {
    const { lastFrame, unmount } = render(<Busy message="Reading spools from SpoolEase…" />);
    const first = lastFrame() ?? "";

    expect(first).toBe(`${SPINNER_FRAMES[0]} Reading spools from SpoolEase…`);
    await wait(250);
    expect(lastFrame()).not.toBe(first);
    expect(lastFrame()).toContain("Reading spools from SpoolEase…");
    unmount();
  });
});
