// ABOUTME: Tests for the labels overlay's pure update: fields, size, printer and PDF path, the preview, and making labels.
// ABOUTME: Drives update() with press() keys and its own messages, and checks the model and the messages sent.

import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from "../src/labelSettings.js";
import { LABEL_FIELDS } from "../src/labels.js";
import { press } from "../src/tui/core/keys.js";
import type { Ctx, Step, TabMsg } from "../src/tui/core/types.js";
import {
  FIELD_ROWS,
  hints,
  init,
  type LabelsModel,
  labelPreview,
  labelTarget,
  MAKE_ROW,
  OUTPUT_ROW,
  PRINTER_ROW,
  SIZE_ROW,
  update,
} from "../src/tui/overlays/labels/model.js";
import { consoleOf, makeCtx, runCmds, spool } from "./tabSpoolsFixtures.js";

const CTX = makeCtx({
  resources: {
    console: consoleOf([
      spool({ id: "7", brand: "Acme", material: "PETG", colorName: "Red", labelWeight: 1000 }),
      spool({ id: "8", slicerFilament: "P2222222", brand: "Zeta", material: "PLA" }),
    ]),
  },
});

const REQUEST = { spoolIds: ["7", "8"], fresh: false };

function loaded(
  settings: LabelSettings = DEFAULT_LABEL_SETTINGS,
  printers = ["DYMO", "Office"],
  ctx: Ctx = CTX,
): LabelsModel {
  const [model] = init(REQUEST, ctx);
  return msg({ type: "labels/loaded", settings, printers }, model, ctx)[0];
}

function msg(m: TabMsg, model: LabelsModel, ctx: Ctx = CTX): Step<LabelsModel> {
  return update(model, m, ctx);
}

function key(model: LabelsModel, what: string, ctx: Ctx = CTX): Step<LabelsModel> {
  return update(model, { type: "key", key: press(what) }, ctx);
}

function keys(model: LabelsModel, what: string[], ctx: Ctx = CTX): LabelsModel {
  return what.reduce((m, k) => key(m, k, ctx)[0], model);
}

/** The model with the focus on `row`. */
function at(model: LabelsModel, row: number): LabelsModel {
  return { ...model, focus: row };
}

describe("loading", () => {
  it("starts loading the saved choices and the printers, and esc closes", async () => {
    const [model, cmds] = init(REQUEST, CTX);
    expect(model.phase).toBe("loading");
    expect(cmds).toHaveLength(1);
    expect(await runCmds(key(model, "esc")[1])).toEqual([{ type: "app/closeOverlay" }]);
    expect(key(model, "a")[1]).toEqual([]);
  });

  it("takes the saved choices, adds a saved printer that's gone, and starts on Make labels", () => {
    const model = loaded(
      { fields: ["qr", "brand"], size: "62x29mm", printer: "Old", output: "~/l.pdf" },
      ["DYMO"],
    );
    expect(model).toMatchObject({
      phase: "ready",
      fields: ["qr", "brand"],
      size: "62x29mm",
      printers: ["DYMO", "Old"],
      printer: "Old",
      output: { value: "~/l.pdf", cursor: 7 },
      focus: MAKE_ROW,
      error: "",
    });
  });
});

describe("the form", () => {
  it("moves between rows without wrapping", () => {
    expect(keys(loaded(), ["down"]).focus).toBe(MAKE_ROW);
    expect(keys(loaded(), ["up"]).focus).toBe(OUTPUT_ROW);
    expect(keys(at(loaded(), 0), ["up"]).focus).toBe(0);
    expect(keys(loaded(), ["home"]).focus).toBe(0);
  });

  it("ticks fields with space or enter, always in label order", () => {
    const brand = LABEL_FIELDS.findIndex((f) => f.key === "brand");
    const note = LABEL_FIELDS.findIndex((f) => f.key === "note");
    let model = keys(at(loaded(), note), ["space"]);
    expect(model.fields).toEqual([
      "qr",
      "brand",
      "material",
      "color",
      "temps",
      "weight",
      "note",
      "id",
    ]);
    model = keys(at(model, brand), ["enter"]);
    expect(model.fields).not.toContain("brand");
  });

  it("jumps between the two columns of fields with ← and →", () => {
    expect(keys(at(loaded(), 1), ["right"]).focus).toBe(1 + FIELD_ROWS);
    expect(keys(at(loaded(), 1 + FIELD_ROWS), ["left"]).focus).toBe(1);
    expect(keys(at(loaded(), 1), ["left"]).focus).toBe(1);
    expect(keys(at(loaded(), FIELD_ROWS - 1 + FIELD_ROWS), ["right"]).focus).toBe(
      FIELD_ROWS - 1 + FIELD_ROWS,
    );
  });

  it("cycles common sizes with ← and →, and typing replaces the size, then edits it", () => {
    const sized = at(loaded(), SIZE_ROW);
    expect(keys(sized, ["right"]).size).toBe("50x30mm");
    expect(keys(sized, ["left"]).size).toBe("2x1in");
    const typed = keys(sized, ["2", ".", "5", "x", "1", "in"]);
    expect(typed.size).toBe("2.5x1in");
    expect(keys(typed, ["backspace", "backspace"]).size).toBe("2.5x1");
    // A typed size stays in the list while cycling.
    expect(keys(typed, ["right", "left"]).size).toBe("2.5x1in");
  });

  it("cycles the printer through Don't print and the printers", () => {
    const model = at(loaded(), PRINTER_ROW);
    expect(model.printer).toBe("");
    expect(keys(model, ["right"]).printer).toBe("DYMO");
    expect(keys(model, ["right", "right"]).printer).toBe("Office");
    expect(keys(model, ["right", "right", "space"]).printer).toBe("");
    expect(keys(model, ["left"]).printer).toBe("Office");
  });

  it("types every key into the PDF path, a and q included, and enter goes to Make labels", () => {
    const model = keys(at(loaded(), OUTPUT_ROW), ["~", "/", "q", "a", "?", ".pdf"]);
    expect(model.output.value).toBe("~/qa?.pdf");
    expect(model.phase).toBe("ready");
    expect(keys(model, ["enter"]).focus).toBe(MAKE_ROW);
  });

  it("takes a pasted PDF path, line break dropped", () => {
    const [model] = update(at(loaded(), OUTPUT_ROW), { type: "paste", text: "~/end\n" }, CTX);
    expect(model.output.value).toBe("~/end");
    const [onMake, cmds] = update(loaded(), { type: "paste", text: "a" }, CTX);
    expect(onMake.phase).toBe("ready");
    expect(cmds).toEqual([]);
  });

  it("closes with esc from any row", async () => {
    expect(await runCmds(key(at(loaded(), OUTPUT_ROW), "esc")[1])).toEqual([
      { type: "app/closeOverlay" },
    ]);
  });
});

describe("labelTarget", () => {
  it("expands ~ and needs a field, a valid size and somewhere to send the labels", () => {
    const model = loaded();
    expect(labelTarget({ ...model, fields: [] })).toEqual({ error: "Pick at least one field" });
    expect(labelTarget({ ...model, size: "big" })).toEqual({
      error: 'label size must look like 2.5x1.5in or 40x30mm, got "big"',
    });
    expect(labelTarget(model)).toEqual({ error: "Choose a printer, a PDF path, or both" });
    const target = labelTarget({ ...model, output: { value: "~/l.pdf", cursor: 0 } });
    expect(target).toMatchObject({ target: { output: join(homedir(), "l.pdf"), printer: "" } });
    expect(labelTarget({ ...model, printer: "DYMO" })).toMatchObject({
      target: { printer: "DYMO", output: "", fields: DEFAULT_LABEL_SETTINGS.fields },
    });
  });
});

describe("making labels", () => {
  it("shows what's missing instead of making labels", () => {
    const [model, cmds] = key(loaded(), "a");
    expect(model.error).toBe("Choose a printer, a PDF path, or both");
    expect(cmds).toEqual([]);
    expect(keys(model, ["up"]).error).toBe("");
  });

  it("makes them with a or with enter on Make labels", () => {
    const ready = { ...loaded(), printer: "DYMO" };
    for (const press of ["a", "enter"]) {
      const [model, cmds] = key(ready, press);
      expect(model.phase).toBe("making");
      expect(cmds).toHaveLength(1);
    }
  });

  it("closes when done, and esc closes while making", async () => {
    const [making] = key({ ...loaded(), printer: "DYMO" }, "a");
    expect(await runCmds(msg({ type: "labels/made" }, making)[1])).toEqual([
      { type: "app/closeOverlay" },
    ]);
    expect(await runCmds(key(making, "esc")[1])).toEqual([{ type: "app/closeOverlay" }]);
    expect(key(making, "a")[1]).toEqual([]);
    // A late reply to a form that isn't making does nothing.
    expect(msg({ type: "labels/made" }, loaded())[1]).toEqual([]);
  });
});

describe("labelPreview", () => {
  it("shows the first spool's label as it prints, following the fields", () => {
    const model = loaded();
    expect(labelPreview(model, CTX)).toEqual({
      spoolId: "7",
      qr: true,
      lines: [
        { field: "brand", text: "Acme", style: "title" },
        { field: "material", text: "PETG", style: "strong" },
        { field: "color", text: "Red", style: "normal" },
        { field: "temps", text: "230–250 °C", style: "normal" },
        { field: "weight", text: "1000 g", style: "normal" },
        { field: "id", text: "Spool #7", style: "small" },
      ],
    });
    expect(labelPreview({ ...model, fields: ["brand"] }, CTX)).toEqual({
      spoolId: "7",
      qr: false,
      lines: [{ field: "brand", text: "Acme", style: "title" }],
    });
  });

  it("is null until the spool is loaded", () => {
    const [model] = init({ spoolIds: ["99"], fresh: true }, CTX);
    expect(labelPreview(model, CTX)).toBeNull();
    expect(labelPreview(model, makeCtx())).toBeNull();
  });
});

describe("hints", () => {
  const keysOf = (model: LabelsModel) => hints(model, CTX).map((h) => h.keys);

  it("follows the focused row", () => {
    expect(keysOf(init(REQUEST, CTX)[0])).toEqual(["esc"]);
    expect(keysOf(loaded())).toEqual(["↑↓", "enter", "esc"]);
    expect(keysOf(at(loaded(), 0))).toEqual(["↑↓", "space", "a", "esc"]);
    expect(keysOf(at(loaded(), SIZE_ROW))).toEqual(["↑↓", "←→", "type", "a", "esc"]);
    expect(keysOf(at(loaded(), PRINTER_ROW))).toEqual(["↑↓", "←→", "a", "esc"]);
    expect(keysOf(at(loaded(), OUTPUT_ROW))).toEqual(["↑↓", "type", "enter", "esc"]);
  });
});
