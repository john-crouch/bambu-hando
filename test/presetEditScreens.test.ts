// ABOUTME: Tests for the keys of the preset editing screens: the preset list, the edit form and All settings.
// ABOUTME: Each screen's key handling is a pure function, tested here without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import { EDIT_FIELDS } from "../src/presetEdit.js";
import { lineInput, initialPresetForm, presetFormInput, presetFormTyping, ALL_ROW, SAVE_ROW } from "../src/tui/PresetForm.js";
import { initialPresetList, presetListInput, presetMatches } from "../src/tui/PresetList.js";
import { initialRawSettings, rawInput, rawKeys, rawTyping } from "../src/tui/RawSettings.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

const row = (k: string) => EDIT_FIELDS.findIndex((f) => f.key === k);

const PRESET = {
  name: "Acme PLA Red @Bambu Lab X1 Carbon 0.4 nozzle",
  filament_id: "PA000001",
  nozzle_temperature: ["220"],
  enable_pressure_advance: ["0"],
  filament_retraction_length: ["nil", "0.4"],
  filament_start_gcode: ["; start\nM400"],
};

describe("lineInput", () => {
  it("types, deletes, sets with enter and cancels with esc", () => {
    expect(lineInput("21", "5", key())).toEqual({ type: "update", text: "215" });
    expect(lineInput("215", "", key({ backspace: true }))).toEqual({ type: "update", text: "21" });
    expect(lineInput("215", "", key({ return: true }))).toEqual({ type: "commit", text: "215" });
    expect(lineInput("215", "", key({ escape: true }))).toEqual({ type: "cancel" });
    expect(lineInput("215", "x", key({ ctrl: true }))).toEqual({ type: "none" });
  });

  it("sets a pasted value that ends in a newline", () => {
    expect(lineInput("", "215\r", key())).toEqual({ type: "commit", text: "215" });
  });
});

describe("presetMatches", () => {
  const presets = [
    { name: "Acme PLA Red", filamentId: "PA000001", printer: "Bambu Lab X1 Carbon 0.4 nozzle", path: "/a" },
    { name: "Acme PETG Blue", filamentId: "PB000002", printer: "Bambu Lab X1 Carbon 0.6 nozzle", path: "/b" },
  ];

  it("keeps the presets with every word in their name, printer or filament ID", () => {
    expect(presetMatches(presets, "")).toEqual(presets);
    expect(presetMatches(presets, "acme 0.6").map((p) => p.path)).toEqual(["/b"]);
    expect(presetMatches(presets, "pa000001").map((p) => p.path)).toEqual(["/a"]);
    expect(presetMatches(presets, "nylon")).toEqual([]);
  });
});

describe("presetListInput", () => {
  const start = initialPresetList();

  it("filters as you type, opens with enter, clears the filter then goes back with esc", () => {
    expect(presetListInput(start, "p", key(), 2, 10)).toEqual({ type: "update", state: { ...start, filter: "p" } });
    expect(presetListInput({ ...start, filter: "pl" }, "", key({ backspace: true }), 2, 10)).toEqual({ type: "update", state: { ...start, filter: "p" } });
    expect(presetListInput({ ...start, cursor: 1 }, "", key({ return: true }), 2, 10)).toEqual({ type: "choose", index: 1 });
    expect(presetListInput(start, "", key({ return: true }), 0, 10)).toEqual({ type: "none" });
    expect(presetListInput({ ...start, filter: "p" }, "", key({ escape: true }), 2, 10)).toEqual({ type: "update", state: start });
    expect(presetListInput(start, "", key({ escape: true }), 2, 10)).toEqual({ type: "back" });
    expect(presetListInput(start, "", key({ downArrow: true }), 2, 10)).toEqual({ type: "update", state: { ...start, cursor: 1 } });
  });
});

describe("presetFormInput", () => {
  const start = initialPresetForm();

  it("starts editing a field from its value and sets what's typed", () => {
    const at = { ...start, cursor: row("nozzle_temperature") };
    expect(presetFormInput(at, "", key({ return: true }), PRESET, 10)).toEqual({ type: "update", state: { ...at, editing: "220" } });
    expect(presetFormTyping({ ...at, editing: "220" })).toBe(true);
    expect(presetFormTyping(at)).toBe(false);

    expect(presetFormInput({ ...at, editing: "21" }, "5", key(), PRESET, 10)).toEqual({ type: "update", state: { ...at, editing: "215" } });
    expect(presetFormInput({ ...at, editing: "215" }, "", key({ return: true }), PRESET, 10)).toEqual({
      type: "set",
      key: "nozzle_temperature",
      edit: { every: "215" },
      state: at,
    });
  });

  it("keeps editing and says why when the value doesn't fit, and esc leaves the value as it was", () => {
    const at = { ...start, cursor: row("nozzle_temperature"), editing: "hot" };
    expect(presetFormInput(at, "", key({ return: true }), PRESET, 10)).toEqual({
      type: "update",
      state: { ...at, error: "Nozzle: type a whole number from 0 to 500" },
    });
    expect(presetFormInput(at, "", key({ escape: true }), PRESET, 10)).toEqual({ type: "update", state: { ...at, editing: null } });
  });

  it("flips a switch with enter, without typing", () => {
    const at = { ...start, cursor: row("enable_pressure_advance") };
    expect(presetFormInput(at, "", key({ return: true }), PRESET, 10)).toEqual({ type: "set", key: "enable_pressure_advance", edit: { every: "1" }, state: at });
    expect(presetFormInput(at, "", key({ return: true }), { ...PRESET, enable_pressure_advance: ["1"] }, 10)).toMatchObject({ edit: { every: "0" } });
  });

  it("undoes a field's change with u, opens All settings and the review from the last rows, and goes back with esc", () => {
    const at = { ...start, cursor: row("nozzle_temperature") };
    expect(presetFormInput(at, "u", key(), PRESET, 10)).toEqual({ type: "undo", key: "nozzle_temperature" });
    expect(presetFormInput({ ...start, cursor: ALL_ROW }, "", key({ return: true }), PRESET, 10)).toEqual({ type: "raw" });
    expect(presetFormInput({ ...start, cursor: SAVE_ROW }, "", key({ return: true }), PRESET, 10)).toEqual({ type: "review" });
    expect(presetFormInput(start, "", key({ escape: true }), PRESET, 10)).toEqual({ type: "back" });
    expect(presetFormInput(start, "", key({ pageDown: true }), PRESET, 10)).toEqual({ type: "update", state: { ...start, cursor: 10 } });
    expect(presetFormInput({ ...start, cursor: SAVE_ROW }, "", key({ downArrow: true }), PRESET, 10)).toEqual({ type: "update", state: { ...start, cursor: SAVE_ROW } });
  });
});

describe("rawInput", () => {
  const start = initialRawSettings();
  const keys = rawKeys(PRESET, "");

  it("lists every key, or those with each word of the filter", () => {
    expect(keys).toEqual(Object.keys(PRESET));
    expect(rawKeys(PRESET, "start gcode")).toEqual(["filament_start_gcode"]);
  });

  it("edits a setting as raw text and sets it with enter", () => {
    const at = { ...start, cursor: keys.indexOf("filament_start_gcode") };
    expect(rawInput(at, "", key({ return: true }), keys, PRESET, 10)).toEqual({ type: "update", state: { ...at, editing: "; start\\nM400" } });
    expect(rawTyping({ ...at, editing: "" })).toBe(true);
    expect(rawInput({ ...at, editing: "G28" }, "", key({ return: true }), keys, PRESET, 10)).toEqual({
      type: "set",
      key: "filament_start_gcode",
      edit: { every: "G28" },
      state: at,
    });
  });

  it("says why a value doesn't fit, and won't edit the keys that identify the preset", () => {
    const variants = { ...start, cursor: keys.indexOf("filament_retraction_length"), editing: "0.6" };
    expect(rawInput(variants, "", key({ return: true }), keys, PRESET, 10)).toMatchObject({ type: "update", state: { editing: "0.6", error: expect.stringContaining("2 values") } });
    const name = { ...start, cursor: keys.indexOf("name") };
    expect(rawInput(name, "", key({ return: true }), keys, PRESET, 10)).toEqual({ type: "update", state: { ...name, error: "name can't be changed here: it comes from the file name" } });
  });

  it("filters as you type, undoes with ctrl+u, clears the filter then goes back with esc", () => {
    expect(rawInput(start, "f", key(), keys, PRESET, 10)).toEqual({ type: "update", state: { ...start, filter: "f" } });
    expect(rawInput(start, "u", key({ ctrl: true }), keys, PRESET, 10)).toEqual({ type: "undo", key: "name" });
    expect(rawInput({ ...start, filter: "f" }, "", key({ escape: true }), keys, PRESET, 10)).toEqual({ type: "update", state: start });
    expect(rawInput(start, "", key({ escape: true }), keys, PRESET, 10)).toEqual({ type: "back" });
  });
});
