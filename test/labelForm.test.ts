// ABOUTME: Unit tests for the TUI label screen's state: field checkboxes, size and PDF path editing, printer choice.
// ABOUTME: Pure key handling and validation, tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_SETTINGS } from "../src/labelSettings.js";
import { parseLabelSize } from "../src/labels.js";
import {
  initialLabelForm,
  labelFormInput,
  labelFormSettings,
  labelFormTarget,
  type LabelFormState,
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
    const state = initialLabelForm({ ...DEFAULT_LABEL_SETTINGS, printer: "Gone-Printer", output: "/tmp/l.pdf" }, PRINTERS);

    expect(state).toMatchObject({ fields: DEFAULT_LABEL_SETTINGS.fields, size: "57x32mm", printer: "Gone-Printer", output: "/tmp/l.pdf", cursor: 0 });
    expect(state.printers).toEqual([...PRINTERS, "Gone-Printer"]);
  });
});

describe("labelFormInput", () => {
  it("moves between rows and toggles fields with space, keeping label order", () => {
    let state = form();
    state = update(state, " ");
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
    expect(update(form(), "", { upArrow: true }).cursor).toBe(0);
    expect(update(form({ cursor: OUTPUT_ROW }), "", { downArrow: true }).cursor).toBe(OUTPUT_ROW);
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

  it("cycles the printer with left and right, including not printing", () => {
    let state = form({ cursor: PRINTER_ROW });
    expect(state.printer).toBe("");
    state = update(state, "", { rightArrow: true });
    expect(state.printer).toBe("Label-Printer");
    state = update(state, "", { rightArrow: true });
    expect(state.printer).toBe("Label-Printer/spools");
    state = update(state, "", { leftArrow: true });
    state = update(state, "", { leftArrow: true });
    expect(state.printer).toBe("");
    state = update(state, "", { leftArrow: true });
    expect(state.printer).toBe("Office-Laser");
  });

  it("ignores typing on rows that aren't text", () => {
    const state = form({ cursor: PRINTER_ROW });
    expect(update(state, "x")).toEqual(state);
  });

  it("submits with enter and goes back with escape", () => {
    expect(labelFormInput(form(), "", key({ return: true }))).toEqual({ type: "submit" });
    expect(labelFormInput(form(), "", key({ escape: true }))).toEqual({ type: "back" });
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
    expect(labelFormTarget(form({ printer: "P", fields: [] }))).toEqual({ error: "Pick at least one field" });
    expect(labelFormTarget(form({ printer: "P", size: "big" }))).toEqual({ error: 'label size must look like 2.5x1.5in or 40x30mm, got "big"' });
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
