// ABOUTME: Tests for the Add tab's "Other color…" dialog: choosing the listed color it's like, typing name and hex, validation.
// ABOUTME: colorVariant keeps the base's settings and derives the new color's own filament ID.

import { describe, expect, it } from "vitest";

import { derivedFilamentId } from "../src/sources.js";
import { press } from "../src/tui/core/keys.js";
import {
  type ColorDialog,
  colorDialogKey,
  colorVariant,
  dialogTyping,
  openColorDialog,
  typedColor,
} from "../src/tui/tabs/add/color.js";
import { PROFILES, profile } from "./tabAddHarness.js";

const BASES = PROFILES.slice(0, 3);

function keys(dialog: ColorDialog, ...presses: string[]): ReturnType<typeof colorDialogKey> {
  let result: ReturnType<typeof colorDialogKey> = { dialog };
  for (const p of presses) {
    if (!("dialog" in result)) return result;
    result = colorDialogKey(result.dialog, press(p), PROFILES);
  }
  return result;
}

function dialogOf(result: ReturnType<typeof colorDialogKey>): ColorDialog {
  if (!("dialog" in result)) throw new Error(`expected a dialog, got ${JSON.stringify(result)}`);
  return result.dialog;
}

describe("colorVariant", () => {
  it("keeps the base's settings with the new name, color and derived ID, and no slicer code", () => {
    const base = profile({ name: "Acme PLA Red", colorName: "Red", slicerFilamentCode: "GFA00" });
    const variant = colorVariant(base, "Moss", "4A5D23FF");
    expect(variant).toEqual({
      ...base,
      name: "Acme PLA Moss",
      colorName: "Moss",
      colorRgba: "4A5D23FF",
      slicerFilamentCode: "",
      filamentId: derivedFilamentId("Acme PLA Moss"),
    });
  });

  it("keeps the base's line in filament-db, but not its listed color's own values", () => {
    const base = profile({ sourceIds: { spoolmanDb: "acme_pla_red_1000_175_n" } });
    expect(colorVariant(base, "Moss", "4A5D23FF").sourceIds).toEqual({
      spoolmanDb: "acme_pla_red_1000_175_n",
      lineOnly: true,
    });
  });

  it("builds the name from brand and material when the base's name doesn't end in its color", () => {
    const base = profile({ name: "Acme Special", colorName: "Red" });
    expect(colorVariant(base, "Moss", "4A5D23FF").name).toBe("Acme PLA Moss");
  });
});

describe("typedColor", () => {
  it("reads 6 hex digits with or without #", () => {
    expect(typedColor("ad0000")).toBe("#AD0000");
    expect(typedColor(" #4a5d23 ")).toBe("#4A5D23");
    expect(typedColor("ad00")).toBeNull();
  });
});

describe("the dialog", () => {
  const open = () => openColorDialog("Acme", "PLA", BASES);

  it("starts on the base field with the first listed color chosen, or the one given", () => {
    expect(openColorDialog("Acme", "PLA", BASES, PROFILES[0]).base).toBe(2);
    expect(openColorDialog("Acme", "PLA", []).base).toBeNull();
    expect(open()).toMatchObject({
      brand: "Acme",
      material: "PLA",
      base: 0,
      field: "base",
      error: "",
    });
    expect(open().bases.map((p) => p.colorName)).toEqual(["Black", "Blue", "Red"]);
  });

  it("cycles the base with ←/→ and jumps to a color by its first letter", () => {
    expect(dialogOf(keys(open(), "right")).base).toBe(1);
    expect(dialogOf(keys(open(), "left")).base).toBe(2);
    expect(dialogOf(keys(open(), "right", "right", "right", "right")).base).toBe(1);
    expect(dialogOf(keys(open(), "r")).base).toBe(2);
  });

  it("moves between fields with tab and shift+tab, wrapping", () => {
    expect(dialogOf(colorDialogKey(open(), press("tab"), PROFILES)).field).toBe("name");
    expect(dialogOf(colorDialogKey(open(), press("tab", { shift: true }), PROFILES)).field).toBe(
      "add",
    );
  });

  it("moves between fields with ↑/↓ and enter, and types into name and hex", () => {
    const d = dialogOf(keys(open(), "right", "enter", "M", "o", "s", "s", "enter", "4a5d23"));
    expect(d.field).toBe("hex");
    expect(d.name.value).toBe("Moss");
    expect(d.hex.value).toBe("4a5d23");
    expect(dialogOf(keys(d, "up")).field).toBe("name");
    expect(dialogOf(keys(d, "down", "down")).field).toBe("add");
  });

  it("types into text fields only while one has focus", () => {
    expect(dialogTyping(open())).toBe(false);
    expect(dialogTyping(dialogOf(keys(open(), "down")))).toBe(true);
    expect(dialogTyping(dialogOf(keys(open(), "down", "down")))).toBe(true);
    expect(dialogTyping(dialogOf(keys(open(), "down", "down", "down")))).toBe(false);
  });

  it("edits with backspace and the cursor keys inside a text field", () => {
    const d = dialogOf(keys(open(), "down", "M", "s", "left", "o", "end", "s", "backspace"));
    expect(d.name).toEqual({ value: "Mos", cursor: 3 });
  });

  it("closes on esc", () => {
    expect(keys(open(), "esc")).toEqual({ close: true });
  });

  it("says what's missing, in order, and clears the message on the next key", () => {
    const toAdd = ["down", "down", "down"];
    const none = openColorDialog("Acme", "PLA", []);
    expect(dialogOf(keys(none, ...toAdd, "enter")).error).toBe("Choose the listed color it's like");
    expect(dialogOf(keys(open(), "right", ...toAdd, "enter")).error).toBe("Type the color's name");
    expect(dialogOf(keys(open(), "right", "down", "Moss", "down", "down", "enter")).error).toBe(
      "Type the color as 6 hex digits, such as AD0000",
    );
    const listed = keys(open(), "right", "down", "Blue", "down", "0000FF", "down", "enter");
    expect(dialogOf(listed).error).toBe("Acme PLA Blue is already listed");
    expect(dialogOf(keys(dialogOf(listed), "up")).error).toBe("");
  });

  it("adds the variant of the chosen base", () => {
    const result = keys(open(), "r", "down", "Moss", "down", "#4a5d23", "enter", "enter");
    expect(result).toEqual({ added: colorVariant(PROFILES[0]!, "Moss", "4A5D23FF") });
  });
});
