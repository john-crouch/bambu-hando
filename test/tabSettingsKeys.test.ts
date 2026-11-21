// ABOUTME: Tests the Settings tab's own helpers: timed multi-letter type-ahead and the console connection.
// ABOUTME: List moves and text editing come from the design system and are tested with it.

import { describe, expect, it } from "vitest";

import type { FormValues } from "../src/tui/core/values.js";
import {
  byModelAndNozzle,
  connectionOf,
  consoleProblem,
  printerLabel,
  printerList,
  shortPrinters,
  validPort,
} from "../src/tui/tabs/settings/connection.js";
import { TYPE_AHEAD_MS, typeAheadJump } from "../src/tui/tabs/settings/keys.js";
import { wrapText } from "../src/tui/tabs/settings/wrap.js";

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

  it("points a console read's error at the Settings row that fixes it", () => {
    const focus = (error: string) => consoleProblem(error).focus;
    expect(focus("SpoolEase key validation failed")).toBe("spoolease.key");
    expect(
      focus("SpoolEase unreachable at http://10.0.0.5:81: fetch failed: connect ECONNREFUSED"),
    ).toBe("spoolease.port");
    // fetch refuses ports on its blocked list (6000, 6665…) before connecting.
    expect(focus("SpoolEase unreachable at http://10.0.0.5:6000: fetch failed: bad port")).toBe(
      "spoolease.port",
    );
    expect(consoleProblem("fetch failed: Bad port").advice).toContain("port");
    expect(
      focus("SpoolEase unreachable at http://nope.local: fetch failed: getaddrinfo ENOTFOUND"),
    ).toBe("spoolease.host");
  });

  it("splits the printers and shortens them for people, nozzles of a model together", () => {
    expect(printerList(" A , ,B ")).toEqual(["A", "B"]);
    expect(printerLabel("Bambu Lab X1 Carbon 0.4 nozzle")).toBe("X1C 0.4");
    expect(
      shortPrinters([
        "Bambu Lab X1 Carbon 0.4 nozzle",
        "Bambu Lab P1S 0.4 nozzle",
        "Bambu Lab X1 Carbon 0.6 nozzle",
        "Custom thing",
      ]),
    ).toBe("X1C 0.4, 0.6, P1S 0.4, Custom thing");
    const sorted = [
      "Bambu Lab X1 Carbon 0.6 nozzle",
      "Bambu Lab A1 mini 0.4 nozzle",
      "Bambu Lab X1 Carbon 0.2 nozzle",
      "Bambu Lab A1 0.4 nozzle",
    ].sort(byModelAndNozzle);
    expect(sorted.map(printerLabel)).toEqual(["A1 0.4", "A1 mini 0.4", "X1C 0.2", "X1C 0.6"]);
  });
});

describe("wrapText", () => {
  it("breaks at spaces within the width, cutting a word too long for a line", () => {
    expect(wrapText("Spools of these find no preset in the AMS", 16)).toEqual([
      "Spools of these",
      "find no preset",
      "in the AMS",
    ]);
    expect(wrapText("a  b", 10)).toEqual(["a b"]);
    expect(wrapText("supercalifragilistic word", 8)).toEqual(["superca…", "word"]);
    expect(wrapText("", 10)).toEqual([]);
    expect(wrapText("text", 0)).toEqual([]);
  });
});
