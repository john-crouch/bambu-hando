// ABOUTME: Unit tests for the TUI start menu and the shared list helpers (cursor moves, type-ahead).
// ABOUTME: Menus are pure items + keys, so they are tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import { homeInput, homeItems, initialHomeCursor } from "../src/tui/HomeMenu.js";
import { listMove, TYPE_AHEAD_MS, typeAhead, typeAheadJump } from "../src/tui/menu.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

describe("typeAhead", () => {
  const labels = ["Add spools", "Import x.json", "Settings", "Sunlu", "Quit"];

  it("jumps to the next label starting with the typed letter, ignoring case", () => {
    expect(typeAhead(labels, 0, "s")).toBe(2);
    expect(typeAhead(labels, 2, "S")).toBe(3);
  });

  it("wraps around to the first match", () => {
    expect(typeAhead(labels, 3, "s")).toBe(2);
    expect(typeAhead(labels, 4, "a")).toBe(0);
  });

  it("stays put when nothing starts with the letter", () => {
    expect(typeAhead(labels, 1, "z")).toBe(1);
  });
});

describe("typeAheadJump", () => {
  const brands = ["Search by name…", "Siddament", "SMARTFIL", "Snapmaker", "Sunlu", "Ultimaker"];

  it("builds a prefix from letters typed in quick succession", () => {
    const s = typeAheadJump(brands, 0, "s", undefined, 1_000);
    expect(s).toEqual({ cursor: 1, typed: { text: "s", at: 1_000 } });
    expect(typeAheadJump(brands, s.cursor, "u", s.typed, 1_000 + TYPE_AHEAD_MS - 1)).toEqual({ cursor: 4, typed: { text: "su", at: 1_999 } });
  });

  it("starts over after a pause", () => {
    const s = typeAheadJump(brands, 0, "s", undefined, 1_000);
    expect(typeAheadJump(brands, s.cursor, "u", s.typed, 1_000 + TYPE_AHEAD_MS + 1).cursor).toBe(5);
  });

  it("cycles through the items of a repeated letter", () => {
    let jump = typeAheadJump(brands, 0, "s", undefined, 0);
    jump = typeAheadJump(brands, jump.cursor, "s", jump.typed, 10);
    expect(jump.cursor).toBe(2);
    jump = typeAheadJump(brands, jump.cursor, "s", jump.typed, 20);
    expect(jump.cursor).toBe(3);
  });

  it("keeps the cursor on an item that still matches the longer prefix", () => {
    const sm = typeAheadJump(brands, 0, "s", undefined, 0);
    const smart = typeAheadJump(brands, 2, "m", { text: "s", at: 0 }, 10);
    expect(sm.cursor).toBe(1);
    expect(smart.cursor).toBe(2);
  });
});

describe("listMove", () => {
  it("moves with the arrows and pages, within the list", () => {
    expect(listMove(0, key({ downArrow: true }), 5, 3)).toBe(1);
    expect(listMove(4, key({ downArrow: true }), 5, 3)).toBe(4);
    expect(listMove(0, key({ upArrow: true }), 5, 3)).toBe(0);
    expect(listMove(0, key({ pageDown: true }), 5, 3)).toBe(3);
    expect(listMove(4, key({ pageUp: true }), 5, 3)).toBe(1);
  });

  it("returns null for keys that don't move", () => {
    expect(listMove(1, key({ return: true }), 5, 3)).toBeNull();
  });
});

describe("homeItems", () => {
  it("offers SpoolmanDB, more spools of a filament, labels for existing spools, the sync check, settings and quit", () => {
    expect(homeItems("spoolmandb", true).map((i) => i.id)).toEqual(["spoolmandb", "more", "labels", "check", "settings", "quit"]);
    expect(homeItems("", true).map((i) => i.id)).toEqual(["spoolmandb", "more", "labels", "check", "settings", "quit"]);
  });

  it("leaves out what needs the console when SpoolEase is skipped", () => {
    expect(homeItems("spoolmandb", false).map((i) => i.id)).toEqual(["spoolmandb", "settings", "quit"]);
  });

  it("adds an import item for a file or URL source", () => {
    const items = homeItems("/tmp/profiles.json", true);

    expect(items.map((i) => i.id)).toEqual(["spoolmandb", "import", "more", "labels", "check", "settings", "quit"]);
    expect(items[1]?.label).toBe("Import profiles.json");
    expect(homeItems("https://example.com/shared/list.json", true)[1]?.label).toBe("Import list.json");
  });

  it("starts on the import item when there is one, else on SpoolmanDB", () => {
    expect(initialHomeCursor(homeItems("/tmp/profiles.json", true))).toBe(1);
    expect(initialHomeCursor(homeItems("spoolmandb", true))).toBe(0);
  });
});

describe("homeInput", () => {
  const items = homeItems("/tmp/profiles.json", true);

  it("moves, jumps by letter, and chooses with enter", () => {
    expect(homeInput(0, "", key({ downArrow: true }), items)).toEqual({ type: "move", cursor: 1 });
    expect(homeInput(0, "s", key(), items)).toEqual({ type: "move", cursor: 5 });
    expect(homeInput(5, "", key({ return: true }), items)).toEqual({ type: "choose", id: "settings" });
  });

  it("ignores other keys", () => {
    expect(homeInput(0, "", key({ escape: true }), items)).toEqual({ type: "none" });
    expect(homeInput(0, "x", key({ ctrl: true }), items)).toEqual({ type: "none" });
  });
});
