// ABOUTME: Tests for the yes/no terminal prompt `3dfp sync` asks before writing.
// ABOUTME: Only "y" or "yes" is a yes; no terminal means no answer at all, so scripts never hang.

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { askYesNo } from "../src/confirm.js";

function terminal(): {
  input: PassThrough & { isTTY?: boolean };
  output: PassThrough;
  shown: () => string;
} {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += String(chunk)));
  return { input, output, shown: () => text };
}

describe("askYesNo", () => {
  it("takes y or yes, in any case, as yes", async () => {
    for (const typed of ["y\n", "YES\n", "  Yes  \n"]) {
      const { input, output, shown } = terminal();
      const answer = askYesNo("Apply? [y/N] ", input, output);
      input.write(typed);
      expect(await answer).toBe(true);
      expect(shown()).toContain("Apply? [y/N] ");
    }
  });

  it("takes anything else, or an empty line, as no", async () => {
    for (const typed of ["n\n", "\n", "yep\n"]) {
      const { input, output } = terminal();
      const answer = askYesNo("Apply? [y/N] ", input, output);
      input.write(typed);
      expect(await answer).toBe(false);
    }
  });

  it("is a no when the input ends before an answer", async () => {
    const { input, output } = terminal();
    const answer = askYesNo("Apply? [y/N] ", input, output);
    input.end();
    expect(await answer).toBe(false);
  });

  it("doesn't ask without a terminal", async () => {
    const input = new PassThrough();
    expect(await askYesNo("Apply? [y/N] ", input, new PassThrough())).toBeNull();
  });
});
