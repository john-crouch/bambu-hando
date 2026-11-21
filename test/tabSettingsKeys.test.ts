// ABOUTME: Tests the Settings tab's pure helpers: list moves, type-ahead, text editing, and the console connection.
// ABOUTME: These carry the keys every Settings row and list uses, so their edges are pinned here.

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import type { FormValues } from "../src/tui/core/values.js";
import {
  connectionOf,
  consoleUrl,
  printerLabel,
  printerList,
  validPort,
} from "../src/tui/tabs/settings/connection.js";
import {
  editText,
  insertText,
  moveCursor,
  TYPE_AHEAD_MS,
  typeAhead,
  typeAheadJump,
} from "../src/tui/tabs/settings/keys.js";

const VALUES: FormValues = {
  source: "spoolmandb",
  presetFolder: "default",
  printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle",
  overwritePresets: false,
  host: "10.0.0.5",
  port: "80",
  securityKey: "SECRETKEY",
  https: false,
  skipSpoolease: false,
  createSpools: true,
  query: "",
  diameter: 1.75,
};

describe("moveCursor", () => {
  it("moves by one, a page, or to the ends, never past them and never wrapping", () => {
    expect(moveCursor(0, press("up"), 5, 2)).toBe(0);
    expect(moveCursor(0, press("down"), 5, 2)).toBe(1);
    expect(moveCursor(4, press("down"), 5, 2)).toBe(4);
    expect(moveCursor(1, press("pageDown"), 5, 2)).toBe(3);
    expect(moveCursor(1, press("pageUp"), 5, 2)).toBe(0);
    expect(moveCursor(2, press("home"), 5, 2)).toBe(0);
    expect(moveCursor(2, press("end"), 5, 2)).toBe(4);
    expect(moveCursor(0, press("end"), 0, 2)).toBe(0);
  });

  it("leaves other keys alone", () => {
    expect(moveCursor(1, press("enter"), 5, 2)).toBeNull();
    expect(moveCursor(1, press("x"), 5, 2)).toBeNull();
  });
});

describe("typeAhead", () => {
  it("jumps to the next label starting with the letter, wrapping, ignoring case", () => {
    const labels = ["default", "1234", "Demo", "work"];
    expect(typeAhead(labels, 0, "d")).toBe(2);
    expect(typeAhead(labels, 2, "D")).toBe(0);
    expect(typeAhead(labels, 0, "w")).toBe(3);
    expect(typeAhead(labels, 1, "z")).toBe(1);
  });
});

describe("typeAheadJump", () => {
  const labels = ["default", "demo", "Sunlu", "Sunlu Silk", "work"];

  it("builds a prefix from letters typed within the window", () => {
    const s = typeAheadJump(labels, 0, "s", undefined, 1000);
    expect(s).toEqual({ cursor: 2, typed: { text: "s", at: 1000 } });
    const su = typeAheadJump(labels, s.cursor, "u", s.typed, 1500);
    expect(su.cursor).toBe(2);
    const sunlu_ = ["n", "l", "u", " "].reduce(
      (acc, c, i) => typeAheadJump(labels, acc.cursor, c, acc.typed, 1600 + i * 100),
      su,
    );
    expect(sunlu_.cursor).toBe(3);
    expect(typeAheadJump(labels, 0, "d", undefined, 0).cursor).toBe(1);
    const de = typeAheadJump(labels, 1, "e", { text: "d", at: 0 }, 500);
    expect(de.cursor).toBe(1);
    expect(typeAheadJump(labels, 1, "m", de.typed, 900).cursor).toBe(1);
  });

  it("cycles on one letter repeated, and starts over after the window", () => {
    const first = typeAheadJump(labels, 0, "d", undefined, 0);
    expect(first.cursor).toBe(1);
    expect(typeAheadJump(labels, first.cursor, "d", first.typed, 100).cursor).toBe(0);
    const late = typeAheadJump(labels, 2, "w", { text: "su", at: 0 }, TYPE_AHEAD_MS + 1);
    expect(late).toEqual({ cursor: 4, typed: { text: "w", at: TYPE_AHEAD_MS + 1 } });
  });

  it("stays put when nothing starts with the prefix", () => {
    expect(typeAheadJump(labels, 2, "x", { text: "su", at: 0 }, 10).cursor).toBe(2);
  });
});

describe("editText", () => {
  const at = (value: string, cursor = value.length) => ({ value, cursor });

  it("types at the cursor, q and ? included", () => {
    expect(editText(at("ab", 1), press("q"))).toEqual({ value: "aqb", cursor: 2, submit: false });
    expect(editText(at(""), press("?"))).toEqual({ value: "?", cursor: 1, submit: false });
    expect(editText(at("a"), press("space"))).toEqual({ value: "a ", cursor: 2, submit: false });
  });

  it("deletes, moves and submits", () => {
    expect(editText(at("abc"), press("backspace"))).toMatchObject({ value: "ab", cursor: 2 });
    expect(editText(at("abc", 0), press("backspace"))).toMatchObject({ value: "abc", cursor: 0 });
    expect(editText(at("abc", 0), press("delete"))).toMatchObject({ value: "bc", cursor: 0 });
    expect(editText(at("abc"), press("left"))).toMatchObject({ cursor: 2 });
    expect(editText(at("abc", 3), press("right"))).toMatchObject({ cursor: 3 });
    expect(editText(at("abc"), press("home"))).toMatchObject({ cursor: 0 });
    expect(editText(at("abc", 0), press("end"))).toMatchObject({ cursor: 3 });
    expect(editText(at("abc"), press("enter"))).toEqual({ value: "abc", cursor: 3, submit: true });
  });

  it("takes a burst whole, and a burst ending in enter submits what came before it", () => {
    expect(editText(at(""), press("8080"))).toEqual({ value: "8080", cursor: 4, submit: false });
    expect(editText(at(""), press("8080\r"))).toEqual({ value: "8080", cursor: 4, submit: true });
    expect(insertText(at("x"), "ab\nlater")).toEqual({ value: "xab", cursor: 3, submit: true });
  });

  it("leaves ctrl and meta keys and tab to the shell", () => {
    expect(editText(at(""), press("k", { ctrl: true }))).toBeNull();
    expect(editText(at(""), press("tab"))).toBeNull();
    expect(editText(at(""), press("up"))).toBeNull();
  });
});

describe("the console connection", () => {
  it("validates the port", () => {
    expect(validPort("80")).toBe(80);
    expect(validPort(" 65535 ")).toBe(65535);
    for (const bad of ["", "0", "65536", "8.5", "abc", "-1"]) expect(validPort(bad)).toBeNull();
  });

  it("is there only with SpoolEase on and a host, key and valid port", () => {
    expect(connectionOf(VALUES)).toEqual({
      host: "10.0.0.5",
      port: 80,
      securityKey: "SECRETKEY",
      https: false,
    });
    expect(connectionOf({ ...VALUES, skipSpoolease: true })).toBeNull();
    expect(connectionOf({ ...VALUES, host: " " })).toBeNull();
    expect(connectionOf({ ...VALUES, securityKey: "" })).toBeNull();
    expect(connectionOf({ ...VALUES, port: "x" })).toBeNull();
  });

  it("has a URL without the key, the default port left out", () => {
    expect(consoleUrl({ host: "10.0.0.5", port: 80, https: false })).toBe("http://10.0.0.5");
    expect(consoleUrl({ host: "spool.local", port: 8443, https: true })).toBe(
      "https://spool.local:8443",
    );
    expect(consoleUrl({ host: "fe80::1%eth0", port: 80, https: false })).toBe(
      "http://[fe80::1%25eth0]",
    );
  });

  it("splits the printers and drops the vendor for people", () => {
    expect(printerList(" A , ,B ")).toEqual(["A", "B"]);
    expect(printerLabel("Bambu Lab X1 Carbon 0.4 nozzle")).toBe("X1 Carbon 0.4 nozzle");
  });
});
