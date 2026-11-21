// ABOUTME: Tests the SpoolEase console link in a terminal that supports hyperlinks (FORCE_HYPERLINK=1).
// ABOUTME: The link must wrap the visible text in OSC 8 without changing that text or its width.

import { stripVTControlCharacters } from "node:util";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_HYPERLINK = "1";
});

import type { SpoolRecord } from "../src/spoolease.js";
import { LinkedText } from "../src/tui/ConsoleLink.js";
import { SpoolCopies } from "../src/tui/SpoolCopies.js";
import { SyncCheck } from "../src/tui/SyncCheck.js";

const SPOOL: SpoolRecord = {
  id: "7",
  tagId: "",
  material: "PLA",
  subtype: "",
  colorName: "Red",
  colorCodes: ["FF0000FF"],
  note: "",
  brand: "Acme",
  labelWeight: 1000,
  coreWeight: 200,
  fullWeight: null,
  currentWeight: null,
  consumedSinceWeighed: 0,
  slicerFilament: "PABC123",
  addedTime: null,
  location: "",
};

const OPEN = "\u001B]8;;http://host:8080\u0007";

describe("with hyperlink support", () => {
  it("links only the console part and keeps the visible text", () => {
    const { lastFrame } = render(
      <Text>
        <LinkedText parts={["SpoolEase: ", { text: "host", url: "http://host:8080" }, " (x)"]} />
      </Text>,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`${OPEN}host`);
    expect(frame.indexOf(OPEN)).toBe("SpoolEase: ".length);
    expect(stripVTControlCharacters(frame)).toBe("SpoolEase: host (x)");
  });

  it("links the sync check's console", () => {
    const { lastFrame } = render(
      <SyncCheck
        sections={[]}
        top={0}
        compared={[
          "BambuStudio default · SpoolEase ",
          { text: "host:8080", url: "http://host:8080" },
        ]}
        warnings={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`${OPEN}host:8080`);
    expect(stripVTControlCharacters(frame).split("\n")[0]).toBe(
      "Sync check: BambuStudio default · SpoolEase host:8080",
    );
  });

  it("links the more-spools screen's console", () => {
    const { lastFrame } = render(
      <SpoolCopies
        filament={{
          code: "PABC123",
          name: "Acme PLA Red",
          count: 1,
          spool: SPOOL,
        }}
        count={2}
        target={{ text: "http://host:8080", url: "http://host:8080" }}
        results={null}
        running={false}
        outcome={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`${OPEN}http://host:8080`);
    expect(stripVTControlCharacters(frame)).toContain(
      "SpoolEase: http://host:8080 · copies of spool #7",
    );
  });
});
