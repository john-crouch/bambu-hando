// ABOUTME: Tests for the local file linking SpoolEase spools to 3DFilamentProfiles spools.
// ABOUTME: One book of links per 3DFP account and SpoolEase console; others in the file are kept untouched.

import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { loadLinks, type SpoolLink, saveLinks } from "../src/spoolLinks.js";

const link = (overrides: Partial<SpoolLink> = {}): SpoolLink => ({
  spoolease: "1",
  tdfp: "ABC123",
  agreed: { spoolease: 564, tdfp: 564 },
  tag: "04A1B2C3D4E5F6",
  linkedAt: "2026-11-15T13:00:00.000Z",
  ...overrides,
});

describe("spool links", () => {
  let path: string;

  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), "bh-links-")), "nested", "3dfp-links.json");
  });

  it("starts with no links when there's no file", async () => {
    expect(await loadLinks(path, "acct1", "console-a")).toEqual({
      links: [],
      warning: null,
      linkedElsewhere: new Set(),
    });
  });

  it("saves the links and reads them back, readable only by the owner", async () => {
    expect(await saveLinks(path, "acct1", "console-a", [link()])).toBeNull();
    expect(await loadLinks(path, "acct1", "console-a")).toEqual({
      links: [link()],
      warning: null,
      linkedElsewhere: new Set(),
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("keeps each account and console's links apart", async () => {
    await saveLinks(path, "acct1", "console-a", [link()]);
    await saveLinks(path, "acct2", "console-a", [link({ tdfp: "XYZ789" })]);
    await saveLinks(path, "acct1", "console-b", [link({ spoolease: "7" })]);
    expect((await loadLinks(path, "acct1", "console-a")).links).toEqual([link()]);
    expect((await loadLinks(path, "acct2", "console-a")).links).toEqual([link({ tdfp: "XYZ789" })]);
    expect((await loadLinks(path, "acct1", "console-b")).links).toEqual([link({ spoolease: "7" })]);
  });

  it("names the 3DFP spools the account links to other consoles' spools", async () => {
    await saveLinks(path, "acct1", "console-a", [link()]);
    await saveLinks(path, "acct1", "console-b", [link({ tdfp: "BBB222" })]);
    await saveLinks(path, "acct2", "console-c", [link({ tdfp: "CCC333" })]);
    expect((await loadLinks(path, "acct1", "console-a")).linkedElsewhere).toEqual(
      new Set(["BBB222"]),
    );
  });

  it("replaces a book's links when saved again", async () => {
    await saveLinks(path, "acct1", "console-a", [link(), link({ spoolease: "2", tdfp: "DEF456" })]);
    await saveLinks(path, "acct1", "console-a", [link({ agreed: null })]);
    expect((await loadLinks(path, "acct1", "console-a")).links).toEqual([link({ agreed: null })]);
    expect(JSON.parse(await readFile(path, "utf-8")).books).toHaveLength(1);
  });

  it("warns and starts over from a damaged file", async () => {
    await saveLinks(path, "acct1", "console-a", [link()]);
    await writeFile(path, "{not json", "utf-8");
    const loaded = await loadLinks(path, "acct1", "console-a");
    expect(loaded.links).toEqual([]);
    expect(loaded.warning).toMatch(
      /^the spool link file .* can't be read: starting with no links; it will be set aside, not overwritten$/,
    );
  });

  it("sets a damaged file aside instead of overwriting the other books in it", async () => {
    await saveLinks(path, "acct2", "console-a", [link()]);
    await writeFile(
      path,
      '{"books": [{"account": "acct2", "console": "console-a", "links": [',
      "utf-8",
    );
    const kept = await saveLinks(path, "acct1", "console-a", [link({ tdfp: "XYZ789" })]);
    expect(kept).toMatch(/3dfp-links\.json\.damaged-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d/);
    expect(await readFile(kept ?? "", "utf-8")).toContain('"account": "acct2"');
    expect(await loadLinks(path, "acct1", "console-a")).toEqual({
      links: [link({ tdfp: "XYZ789" })],
      warning: null,
      linkedElsewhere: new Set(),
    });
  });

  it("treats a file it can't open as damaged, not as missing", async () => {
    await saveLinks(path, "acct2", "console-a", [link()]);
    await chmod(path, 0o000);
    expect((await loadLinks(path, "acct1", "console-a")).warning).toMatch(/can't be read/);
    const kept = await saveLinks(path, "acct1", "console-a", []);
    expect(kept).not.toBeNull();
    await chmod(kept ?? "", 0o600);
    expect(JSON.parse(await readFile(kept ?? "", "utf-8")).books).toEqual([
      { account: "acct2", console: "console-a", links: [link()] },
    ]);
  });

  it("drops entries that aren't links", async () => {
    const book = {
      account: "acct1",
      console: "console-a",
      links: [
        link(),
        { spoolease: 3 },
        null,
        link({ spoolease: "2", agreed: { spoolease: "x" } as never }),
      ],
    };
    await saveLinks(path, "acct1", "console-a", []);
    await writeFile(path, JSON.stringify({ version: 1, books: [book] }), "utf-8");
    expect((await loadLinks(path, "acct1", "console-a")).links).toEqual([
      link(),
      link({ spoolease: "2", agreed: null }),
    ]);
  });
});
