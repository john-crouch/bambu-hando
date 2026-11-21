// ABOUTME: Tests for the embeddable preset editor: pages per setting group, All settings, typing values, undo, outcomes.
// ABOUTME: Drives the pure updateEditor with press() keys and checks the model, rows, hints and outcomes.

import { describe, expect, it } from "vitest";
import type { Edits, Preset } from "../src/presetEdit.js";
import { type KeyPress, press } from "../src/tui/core/keys.js";
import {
  ALL_SETTINGS,
  EDITOR_GROUPS,
  type EditorModel,
  type EditorOutcome,
  editedPreset,
  editorCapturesText,
  editorCurrentRow,
  editorHints,
  editorPages,
  editorRows,
  editorTakes,
  editorTypingHint,
  editorWarning,
  editWarning,
  initEditor,
  updateEditor,
  withEdit,
} from "../src/tui/tabs/presets/editor.js";

const ORIGINAL: Preset = {
  name: "Acme PLA Red @Bambu Lab X1 Carbon 0.4 nozzle",
  filament_id: "P1234567",
  inherits: "",
  nozzle_temperature: ["220"],
  nozzle_temperature_initial_layer: ["220"],
  nozzle_temperature_range_low: ["190"],
  nozzle_temperature_range_high: ["240"],
  textured_plate_temp: ["55"],
  filament_flow_ratio: ["0.98"],
  enable_pressure_advance: ["0"],
  filament_retraction_length: ["nil"],
  default_filament_colour: ["#FF0000"],
  filament_notes: "",
  compatible_printers: ["Bambu Lab X1 Carbon 0.4 nozzle"],
  filament_vendor: ["Acme"],
  slow_down_layer_time: ["4", "6"],
  some_number: 3,
};

function open(mode: "preset" | "planned" = "preset", edits?: Edits): EditorModel {
  return initEditor({
    name: "Acme PLA Red",
    printer: "Bambu Lab X1 Carbon 0.4 nozzle",
    path: "/tmp/acme.json",
    original: ORIGINAL,
    ...(edits ? { edits } : {}),
    mode,
  });
}

/** Sends the keys in order; returns the last model and every outcome seen. */
function keys(
  model: EditorModel,
  ...pressed: (KeyPress | string)[]
): { model: EditorModel; outcomes: EditorOutcome[] } {
  const outcomes: EditorOutcome[] = [];
  let current = model;
  for (const key of pressed) {
    const step = updateEditor(current, typeof key === "string" ? press(key) : key);
    current = step.model;
    if (step.outcome) outcomes.push(step.outcome);
  }
  return { model: current, outcomes };
}

function row(model: EditorModel, key: string) {
  return editorRows(model).find((r) => r.key === key);
}

describe("pages", () => {
  it("has a page per setting group and then All settings, moved through with left and right", () => {
    expect(EDITOR_GROUPS).toEqual([
      "Temperature",
      "Bed",
      "Flow",
      "Retraction",
      "Cooling",
      "Filament",
    ]);
    const model = open();
    expect(model.page).toBe(0);
    // The Temperature group holds only nozzle temperatures (Bed has the plates'), so its page says so.
    expect(editorPages(model).map((p) => p.title)).toEqual([
      "Nozzle",
      ...EDITOR_GROUPS.slice(1),
      "All",
    ]);
    expect(keys(model, "left").model.page).toBe(0);
    expect(keys(model, "right", "right").model.page).toBe(2);
    const last = keys(model, ...Array(10).fill("right")).model;
    expect(last.page).toBe(ALL_SETTINGS);
  });

  it("lists a group's fields with units, and keeps each page's cursor", () => {
    const model = open();
    expect(editorRows(model).map((r) => r.label)).toEqual([
      "Nozzle",
      "Nozzle, first layer",
      "Nozzle range, low",
      "Nozzle range, high",
    ]);
    expect(row(model, "nozzle_temperature")).toMatchObject({ value: "220°C", changed: false });
    const moved = keys(model, "down", "down", "right", "left").model;
    expect(moved.cursors[0]).toBe(2);
    expect(keys(moved, "right").model.cursors[1]).toBe(0);
  });

  it("counts each page's changes as its badge", () => {
    const edits: Edits = new Map([
      ["nozzle_temperature", { every: "230" }],
      ["filament_vendor", { every: "Acme Co" }],
    ]);
    const pages = editorPages(open("preset", edits));
    expect(pages[0]?.badge).toBe("1");
    expect(pages[1]?.badge).toBeUndefined();
    expect(pages[ALL_SETTINGS]?.badge).toBe("1");
  });
});

describe("editing a field", () => {
  it("starts from the value, all of it selected: typing replaces it, enter sets it", () => {
    const start = keys(open(), "enter").model;
    expect(start.text).toEqual({ value: "220", cursor: 3 });
    expect(start.selected).toBe(true);
    expect(editorCapturesText(start)).toBe(true);
    const { model } = keys(start, "245", "enter");
    expect(model.text).toBeNull();
    expect(model.edits.get("nozzle_temperature")).toEqual({ every: "245" });
    expect(row(model, "nozzle_temperature")).toMatchObject({
      value: "245°C",
      was: "220°C",
      changed: true,
    });
    expect(editedPreset(model).nozzle_temperature).toEqual(["245"]);
  });

  it("keeps typing and says why when the value doesn't fit; esc leaves it as it was", () => {
    const bad = keys(open(), "enter", "x", "enter").model;
    expect(bad.text?.value).toBe("x");
    expect(bad.error).toBe("Nozzle: type a whole number from 0 to 500");
    const cancelled = keys(bad, "esc").model;
    expect(cancelled.text).toBeNull();
    expect(cancelled.error).toBe("");
    expect(cancelled.edits.size).toBe(0);
  });

  it("types ?, q, u, a and / into the value instead of acting on them", () => {
    const { model, outcomes } = keys(
      open("preset"),
      "right",
      "right",
      "right",
      "right",
      "right",
      "end",
      "enter",
      "?qua/",
    );
    expect(outcomes).toEqual([]);
    expect(model.text?.value).toBe("?qua/");
  });

  it("clears the selected value with backspace; home, end or a text field's arrows keep it to edit", () => {
    expect(keys(open(), "enter", "backspace").model.text).toEqual({ value: "", cursor: 0 });
    const kept = keys(open(), "enter", "home", "1").model;
    expect(kept.text?.value).toBe("1220");
    expect(kept.selected).toBe(false);
    const vendor = keys(
      open(),
      ...Array(ALL_SETTINGS).fill("right"),
      "/",
      "vendor",
      "enter",
      "enter",
    ).model;
    expect(keys(vendor, "left", "x").model.text?.value).toBe("Acmxe");
  });

  it("sets a pasted value that ends in a newline, as enter would", () => {
    const { model } = keys(open(), "enter", "235\r");
    expect(model.text).toBeNull();
    expect(model.edits.get("nozzle_temperature")).toEqual({ every: "235" });
  });

  it("drops an edit that leaves the value as it is on disk", () => {
    const changed = keys(open(), "enter", "225", "enter").model;
    expect(changed.edits.size).toBe(1);
    const back = keys(changed, "enter", "220", "enter").model;
    expect(back.edits.size).toBe(0);
  });

  it("toggles a switch with space or enter, without typing", () => {
    const flow = keys(open(), "right", "right").model;
    const at = keys(flow, "down", "down").model;
    expect(editorRows(at)[2]?.key).toBe("enable_pressure_advance");
    const on = keys(at, "space").model;
    expect(on.text).toBeNull();
    expect(on.edits.get("enable_pressure_advance")).toEqual({ every: "1" });
    expect(row(on, "enable_pressure_advance")).toMatchObject({ value: "on", was: "off" });
    expect(keys(on, "enter").model.edits.size).toBe(0);
  });

  it("starts a nilable field empty and sets the printer's value from nothing", () => {
    const retraction = keys(open(), "right", "right", "right").model;
    expect(row(retraction, "filament_retraction_length")?.value).toBe("printer's");
    const typing = keys(retraction, "enter").model;
    expect(typing.text?.value).toBe("");
    expect(keys(typing, "1.2", "enter").model.edits.get("filament_retraction_length")).toEqual({
      every: "1.2",
    });
  });

  it("undoes the field at the cursor with u or ctrl+u", () => {
    const changed = keys(open(), "enter", "225", "enter", "down").model;
    expect(keys(changed, "u").model.edits.size).toBe(1);
    expect(keys(changed, "up", "u").model.edits.size).toBe(0);
    expect(keys(changed, "up", press("u", { ctrl: true })).model.edits.size).toBe(0);
  });

  it("says what a field takes while typing it", () => {
    const typing = keys(open(), "enter").model;
    expect(editorTypingHint(typing)).toBe("a whole number, 0–500");
    const notes = keys(open(), ...Array(5).fill("right"), "end", "enter").model;
    expect(editorTypingHint(notes)).toBe("text; \\n starts a new line");
    expect(editorTypingHint(open())).toBe("");
  });
});

describe("stepping a number", () => {
  it("steps an open number field with left and right (or up and down), shift by five, within bounds", () => {
    const at = keys(open(), "enter").model;
    expect(keys(at, "right").model.text?.value).toBe("221");
    expect(keys(at, "up", "up").model.text?.value).toBe("222");
    expect(keys(at, "left").model.text?.value).toBe("219");
    expect(keys(at, press("right", { shift: true })).model.text?.value).toBe("225");
    expect(keys(at, "down", press("left", { shift: true })).model.text?.value).toBe("214");
    expect(keys(at, "right", "enter").model.edits.get("nozzle_temperature")).toEqual({
      every: "221",
    });
    // Stepped, the value stays selected: typing still replaces it.
    expect(keys(at, "right", "9").model.text?.value).toBe("9");
    const top = keys(open(), "enter", "500", "right").model;
    expect(top.text?.value).toBe("500");
  });

  it("steps decimals by the setting's own step, and starts an empty field from its lowest value", () => {
    const flow = keys(open(), "right", "right", "enter").model;
    expect(keys(flow, "right").model.text?.value).toBe("0.99");
    expect(keys(flow, press("left", { shift: true })).model.text?.value).toBe("0.93");
    const retraction = keys(open(), "right", "right", "right", "enter").model;
    expect(retraction.text?.value).toBe("");
    expect(keys(retraction, "right").model.text?.value).toBe("0.1");
    const typo = keys(open(), "enter", "x", "right").model;
    expect(typo.text?.value).toBe("221");
  });
});

describe("page keys", () => {
  it("jumps to a page with its number, 1 to 7", () => {
    expect(keys(open(), "3").model.page).toBe(2);
    expect(keys(open(), "7").model.page).toBe(ALL_SETTINGS);
    expect(keys(open(), "8").model.page).toBe(0);
    expect(keys(open(), "enter", "3").model.page).toBe(0);
  });
});

describe("editorTakes", () => {
  it("says what the highlighted setting takes, typing or not", () => {
    expect(editorTakes(open())).toBe("a whole number, 0–500");
    expect(editorCurrentRow(open())?.key).toBe("nozzle_temperature");
    const flow = keys(open(), "right", "right", "down", "down").model;
    expect(editorTakes(flow)).toBe("on or off");
    const retraction = keys(open(), "right", "right", "right").model;
    expect(editorTakes(retraction)).toBe("a number, 0–20, or nothing for the printer's");
    const color = keys(open(), ...Array(ALL_SETTINGS - 1).fill("right")).model;
    expect(editorCurrentRow(color)?.key).toBe("default_filament_colour");
    expect(editorTakes(color)).toBe("6 hex digits, or nothing for none");
    const all = keys(open(), ...Array(ALL_SETTINGS).fill("right")).model;
    expect(editorTakes(all)).toBe("");
    expect(editorTakes(keys(all, "end").model)).toBe("");
    expect(editorTakes(keys(all, "/", "vendor", "esc").model)).toBe("");
    expect(editorTakes(keys(all, "/", "vendor").model)).toBe("text");
    expect(editorTakes(keys(all, "/", "notes").model)).toBe("text; \\n starts a new line");
    expect(editorTakes(keys(all, "/", "flow ratio").model)).toBe("a number");
    expect(editorTakes(keys(all, "/", "slow_down").model)).toBe("a JSON list of 2 values");
  });
});

describe("variants", () => {
  const VARIANTS: Preset = {
    ...ORIGINAL,
    filament_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow"],
    filament_max_volumetric_speed: ["22", "29"],
  };
  const flow = () =>
    keys(
      initEditor({ name: "Acme", printer: "", original: VARIANTS, mode: "preset" }),
      "right",
      "right",
      "down",
    ).model;

  it("names each nozzle type's value when they differ", () => {
    expect(editorCurrentRow(flow())).toMatchObject({
      key: "filament_max_volumetric_speed",
      value: "standard 22 · high flow 29 mm³/s",
    });
  });

  it("says that one value goes to every nozzle type", () => {
    expect(editorTakes(flow())).toBe("a number, 0.1–200; one value for every nozzle type");
    expect(editorTakes(keys(flow(), "up").model)).toBe("a number, 0.01–2");
  });

  it("records no edit for a field confirmed as it was: its variants stay apart", () => {
    expect(keys(flow(), "enter", "enter").model.edits.size).toBe(0);
    // Stepped there and back, or against its bound, is no change either.
    expect(keys(flow(), "enter", "right", "left", "enter").model.edits.size).toBe(0);
    const top = { ...VARIANTS, filament_max_volumetric_speed: ["200", "29"] };
    const atTop = keys(
      initEditor({ name: "Acme", printer: "", original: top, mode: "preset" }),
      "right",
      "right",
      "down",
      "enter",
      "right",
      "enter",
    ).model;
    expect(atTop.edits.size).toBe(0);
    // A value that really changes still goes into every variant.
    const set = keys(flow(), "enter", "right", "enter").model;
    expect(set.edits.get("filament_max_volumetric_speed")).toEqual({ every: "22.5" });
  });

  it("records no edit for a printer's-value field confirmed empty", () => {
    const nil: Preset = { ...VARIANTS, filament_retraction_length: ["nil", "0.4"] };
    const model = initEditor({ name: "Acme", printer: "", original: nil, mode: "preset" });
    const page = EDITOR_GROUPS.indexOf("Retraction");
    const on = keys(model, ...Array(page).fill("right")).model;
    const row = editorRows(on).findIndex((r) => r.key === "filament_retraction_length");
    const at = keys(on, ...Array(row).fill("down")).model;
    expect(editorCurrentRow(at)?.key).toBe("filament_retraction_length");
    expect(keys(at, "enter", "enter").model.edits.size).toBe(0);
    const typed = keys(at, "enter", "1", "enter").model;
    expect(typed.edits.get("filament_retraction_length")).toEqual({ every: "1" });
  });
});

describe("editorWarning", () => {
  const typed = (model: EditorModel, value: string) =>
    keys(model, "enter", ...value.split(""), "enter").model;

  it("warns, without refusing, about a nozzle outside 150–350°C or a bed over 120°C", () => {
    const cold = typed(open(), "5");
    expect(editorRows(cold)[0]).toMatchObject({ value: "5°C", changed: true });
    expect(editorWarning(cold)).toBe("5°C is low for a nozzle (most take 150–350°C)");
    expect(editorWarning(typed(open(), "400"))).toBe(
      "400°C is high for a nozzle (most take 150–350°C)",
    );
    expect(editorWarning(typed(open(), "230"))).toBe("");
    const bed = keys(open(), "right").model;
    expect(editorWarning(typed(bed, "130"))).toBe("130°C is high for a bed (most go up to 120°C)");
    expect(editorWarning(typed(bed, "0"))).toBe("");
  });

  it("warns about the value being typed once it's a number", () => {
    const typing = keys(open(), "enter", "9").model;
    expect(editorWarning(typing)).toBe("9°C is low for a nozzle (most take 150–350°C)");
    expect(editorWarning(keys(typing, "backspace", "2", "0", "0").model)).toBe("");
  });

  it("checks an edit by key and value, for the review", () => {
    expect(editWarning("nozzle_temperature_initial_layer", "100")).toBe(
      "100°C is low for a nozzle (most take 150–350°C)",
    );
    expect(editWarning("cool_plate_temp_initial_layer", "121")).toBe(
      "121°C is high for a bed (most go up to 120°C)",
    );
    expect(editWarning("filament_flow_ratio", "5")).toBe("");
  });
});

describe("All settings", () => {
  const all = () => keys(open(), ...Array(ALL_SETTINGS).fill("right")).model;

  it("lists every key in file order with its raw text, locked keys with their reason", () => {
    const rows = editorRows(all());
    expect(rows.map((r) => r.key)).toEqual(Object.keys(ORIGINAL));
    expect(rows[0]).toMatchObject({ key: "name", locked: "it comes from the file name" });
    expect(rows.find((r) => r.key === "slow_down_layer_time")?.value).toBe('["4","6"]');
    expect(rows.find((r) => r.key === "filament_notes")?.value).toBe('""');
  });

  it("filters with / by words split on spaces and underscores; esc clears the filter", () => {
    const filtering = keys(all(), "/").model;
    expect(editorCapturesText(filtering)).toBe(true);
    const typed = keys(filtering, "range low").model;
    expect(editorRows(typed).map((r) => r.key)).toEqual(["nozzle_temperature_range_low"]);
    const cleared = keys(typed, "esc").model;
    expect(cleared.filter).toEqual({ text: { value: "", cursor: 0 }, focused: false });
    expect(editorRows(cleared)).toHaveLength(Object.keys(ORIGINAL).length);
  });

  it("keeps the filter with enter, leaving the field; enter again edits the highlighted key", () => {
    const kept = keys(all(), "/", "vendor", "enter").model;
    expect(kept.filter.focused).toBe(false);
    expect(kept.filter.text.value).toBe("vendor");
    expect(kept.text).toBeNull();
    const { model } = keys(kept, "enter");
    expect(model.text?.value).toBe("Acme");
    const set = keys(model, "end", " Co", "enter").model;
    expect(set.edits.get("filament_vendor")).toEqual({ every: "Acme Co" });
    expect(set.filter.text.value).toBe("vendor");
  });

  it("refuses locked keys and values that aren't text, saying why", () => {
    const locked = keys(all(), "enter").model;
    expect(locked.text).toBeNull();
    expect(locked.error).toBe("name can't be changed here: it comes from the file name");
    const number = keys(all(), "end", "enter").model;
    expect(number.error).toBe("some_number isn't text; change it in BambuStudio");
  });

  it("checks lists whose variants differ as JSON lists", () => {
    const at = keys(all(), "/", "slow_down", "enter", "enter").model;
    expect(at.text?.value).toBe('["4","6"]');
    const bad = keys(at, "end", "backspace", "enter").model;
    expect(bad.error).toMatch(/^Type 2 values as a JSON list/);
    const good = keys(
      bad,
      "esc",
      "enter",
      "end",
      "backspace",
      "backspace",
      "backspace",
      "backspace",
      '"8"]',
      "enter",
    ).model;
    expect(good.edits.get("slow_down_layer_time")).toEqual({ each: ["4", "8"] });
  });

  it("shares edits with the group pages and undoes with u", () => {
    const edits: Edits = new Map([["nozzle_temperature", { every: "230" }]]);
    const model = keys(
      open("preset", edits),
      ...Array(ALL_SETTINGS).fill("right"),
      "/",
      "nozzle_temperature",
    ).model;
    expect(editorRows(model)[0]).toMatchObject({
      key: "nozzle_temperature",
      value: "230",
      changed: true,
    });
    const atKey = keys(
      open("preset", edits),
      ...Array(ALL_SETTINGS).fill("right"),
      "down",
      "down",
      "down",
    );
    expect(editorRows(atKey.model)[3]?.key).toBe("nozzle_temperature");
    expect(keys(atKey.model, "u").model.edits.size).toBe(0);
  });
});

describe("outcomes", () => {
  const edits: Edits = new Map([["nozzle_temperature", { every: "230" }]]);

  it("leaves with esc keeping the edits, in either mode", () => {
    expect(keys(open("preset", edits), "esc").outcomes).toEqual([{ type: "leave", edits }]);
    expect(keys(open("planned", edits), "esc").outcomes).toEqual([{ type: "leave", edits }]);
  });

  it("goes to the review with a once something changed", () => {
    expect(keys(open("preset", edits), "a").outcomes).toEqual([{ type: "review", edits }]);
    const nothing = keys(open("preset"), "a");
    expect(nothing.outcomes).toEqual([{ type: "error", message: "Nothing changed yet" }]);
    expect(nothing.model.error).toBe("Nothing changed yet");
  });

  it("won't review, or leave a planned preset, with the nozzle range running high to low", () => {
    const backwards: Edits = new Map([["nozzle_temperature_range_low", { every: "250" }]]);
    const message = "Nozzle range: low (250 °C) is above high (240 °C)";
    expect(keys(open("preset", backwards), "a").outcomes).toEqual([{ type: "error", message }]);
    expect(keys(open("planned", backwards), "esc").outcomes).toEqual([{ type: "error", message }]);
    // A preset's draft can wait, half done, until it's reviewed.
    expect(keys(open("preset", backwards), "esc").outcomes).toEqual([
      { type: "leave", edits: backwards },
    ]);
  });

  it("finishes a planned preset with a too, since it has no review of its own", () => {
    expect(keys(open("planned", edits), "a").outcomes).toEqual([{ type: "leave", edits }]);
  });
});

describe("hints", () => {
  it("lists the keys that work at the cursor", () => {
    const labels = (model: EditorModel) => editorHints(model).map((h) => `${h.keys} ${h.label}`);
    expect(labels(open())).toEqual([
      "↑↓ move",
      "enter edit",
      "a review",
      "←→ page",
      "1-7 jump to a page",
      "esc back",
    ]);
    expect(labels(keys(open(), "enter").model)).toEqual([
      "←→ step",
      "shift+←→ step ×5",
      "enter set",
      "esc cancel",
    ]);
    const notes = keys(open(), ...Array(5).fill("right"), "end", "enter").model;
    expect(labels(notes)).toEqual(["enter set", "esc cancel"]);
    const changed = keys(open(), "enter", "225", "enter").model;
    expect(labels(changed)).toContain("u undo");
    expect(labels(open("planned"))).toContain("a done");
    const flow = keys(open(), "right", "right", "down", "down").model;
    expect(labels(flow)[1]).toBe("space toggle");
    const all = keys(open(), ...Array(ALL_SETTINGS).fill("right")).model;
    expect(labels(all)).toContain("/ filter");
    expect(labels(keys(all, "/").model)).toEqual(["↑↓ move", "enter done", "esc clear"]);
  });
});

describe("withEdit", () => {
  it("keeps only edits that change the value on disk, and removes one when given null", () => {
    const none: Edits = new Map();
    const one = withEdit(ORIGINAL, none, "nozzle_temperature", { every: "230" });
    expect([...one.keys()]).toEqual(["nozzle_temperature"]);
    expect(withEdit(ORIGINAL, one, "nozzle_temperature", { every: "220" }).size).toBe(0);
    expect(withEdit(ORIGINAL, one, "nozzle_temperature", null).size).toBe(0);
    expect(one).not.toBe(none);
  });
});
