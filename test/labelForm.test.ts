// ABOUTME: Unit tests for the TUI label screen's state: field checkboxes, size and PDF path editing, printer choice.
// ABOUTME: Pure key handling and validation, tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_SETTINGS } from "../src/labelSettings.js";
import { parseLabelSize } from "../src/labels.js";
import {
  initialLabelForm,
  type LabelFormState,
  labelFormInput,
  labelFormSettings,
  labelFormTarget,
  labelPrinterItems,
  labelSizeItems,
  MAKE_ROW,
  OUTPUT_ROW,
  PRINTER_ROW,
  SIZE_ROW,
} from "../src/tui/LabelForm.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

const PRINTERS = ["Label-Printer", "Label-Printer/spools", "Office-Laser"];

function form(overrides: Partial<LabelFormState> = {}): LabelFormState {
  return { ...initialLabelForm(DEFAULT_LABEL_SETTINGS, PRINTERS), ...overrides };
}

function update(state: LabelFormState, input: string, k: Partial<Key> = {}): LabelFormState {
  const action = labelFormInput(state, input, key(k));
  if (action.type !== "update") throw new Error(`expected an update, got ${action.type}`);
  return action.state;
}

describe("initialLabelForm", () => {
  it("starts from the saved choices, offering a saved printer even when lpstat doesn't list it", () => {
    const state = initialLabelForm(
      { ...DEFAULT_LABEL_SETTINGS, printer: "Gone-Printer", output: "/tmp/l.pdf" },
      PRINTERS,
    );

    // The choices are remembered, so the cursor starts on Make labels.
    expect(state).toMatchObject({
      fields: DEFAULT_LABEL_SETTINGS.fields,
      size: "57x32mm",
      printer: "Gone-Printer",
      output: "/tmp/l.pdf",
      cursor: MAKE_ROW,
    });
    expect(state.printers).toEqual([...PRINTERS, "Gone-Printer"]);
  });
});

describe("labelFormInput", () => {
  it("moves between rows and toggles fields with space or enter, keeping label order", () => {
    let state = form({ cursor: 0 });
    state = update(state, "", { return: true });
    expect(state.fields).not.toContain("qr");
    state = update(state, "", { downArrow: true });
    state = update(state, "", { downArrow: true });
    state = update(state, "", { downArrow: true });
    state = update(state, " ");
    expect(state.fields).toEqual(["brand", "material", "name", "color", "temps", "weight", "id"]);
    state = update(state, "", { upArrow: true });
    state = update(state, "", { upArrow: true });
    state = update(state, "", { upArrow: true });
    state = update(state, " ");
    expect(state.fields[0]).toBe("qr");
  });

  it("stops at the first and last rows", () => {
    expect(update(form({ cursor: 0 }), "", { upArrow: true }).cursor).toBe(0);
    expect(update(form(), "", { downArrow: true }).cursor).toBe(MAKE_ROW);
  });

  it("edits the size and PDF path by typing", () => {
    let state = form({ cursor: SIZE_ROW });
    state = update(state, "", { backspace: true });
    state = update(state, "", { backspace: true });
    state = update(state, "", { backspace: true });
    state = update(state, "in");
    expect(state.size).toBe("57x3in");

    state = update({ ...state, cursor: OUTPUT_ROW }, "~/my labels.pdf");
    expect(state.output).toBe("~/my labels.pdf");
  });

  it("opens the size and printer lists with enter or space", () => {
    expect(labelFormInput(form({ cursor: SIZE_ROW }), "", key({ return: true }))).toEqual({
      type: "choose",
      list: "size",
    });
    expect(labelFormInput(form({ cursor: PRINTER_ROW }), " ", key())).toEqual({
      type: "choose",
      list: "printer",
    });
  });

  it("moves on from the PDF path with enter", () => {
    expect(update(form({ cursor: OUTPUT_ROW }), "", { return: true }).cursor).toBe(MAKE_ROW);
  });

  it("ignores typing on rows that aren't text", () => {
    const state = form({ cursor: PRINTER_ROW });
    expect(update(state, "x")).toEqual(state);
  });

  it("makes the labels with enter on its row, and goes back with escape", () => {
    expect(labelFormInput(form(), "", key({ return: true }))).toEqual({ type: "submit" });
    expect(labelFormInput(form(), "", key({ escape: true }))).toEqual({ type: "back" });
  });
});

describe("label lists", () => {
  it("offers common label sizes, the default first, plus a size of your own", () => {
    expect(labelSizeItems("57x32mm")[0]).toMatchObject({ value: "57x32mm" });
    expect(labelSizeItems("57x32mm").every((item) => parseLabelSize(item.value))).toBe(true);
    expect(labelSizeItems("70x40mm").at(-1)).toEqual({
      value: "70x40mm",
      label: "70x40mm",
      detail: "your size",
    });
  });

  it("offers not printing, then every printer", () => {
    expect(labelPrinterItems(PRINTERS).map((i) => i.value)).toEqual(["", ...PRINTERS]);
    expect(labelPrinterItems(PRINTERS)[0]?.label).toBe("Don't print");
  });
});

describe("labelFormTarget", () => {
  it("turns the form into a label job, expanding ~ in the PDF path", () => {
    const state = form({ printer: "Label-Printer/spools", output: "~/labels.pdf" });

    expect(labelFormTarget(state, "/home/max")).toEqual({
      target: {
        fields: DEFAULT_LABEL_SETTINGS.fields,
        size: parseLabelSize("57x32mm"),
        output: "/home/max/labels.pdf",
        printer: "Label-Printer/spools",
        printOptions: [],
      },
    });
  });

  it("explains what is missing", () => {
    expect(labelFormTarget(form({ printer: "P", fields: [] }))).toEqual({
      error: "Pick at least one field",
    });
    expect(labelFormTarget(form({ printer: "P", size: "big" }))).toEqual({
      error: 'label size must look like 2.5x1.5in or 40x30mm, got "big"',
    });
    expect(labelFormTarget(form())).toEqual({ error: "Choose a printer, a PDF path, or both" });
  });

  it("saves the choices as typed", () => {
    expect(labelFormSettings(form({ printer: "P", output: "~/l.pdf", size: "40x30mm" }))).toEqual({
      fields: DEFAULT_LABEL_SETTINGS.fields,
      size: "40x30mm",
      printer: "P",
      output: "~/l.pdf",
    });
  });
});
