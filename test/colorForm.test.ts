// ABOUTME: Unit tests for the "Other color…" form: rows, typing, and the new profile copied from a listed color.
// ABOUTME: The form is pure state + keys, so it is tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { derivedFilamentId } from "../src/sources.js";
import {
  ADD_ROW,
  BASE_ROW,
  type ColorFormAction,
  type ColorFormState,
  colorFormInput,
  colorFormProfile,
  colorVariant,
  HEX_ROW,
  initialColorForm,
  NAME_ROW,
} from "../src/tui/ColorForm.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

const RED: FilamentProfile = {
  name: "Sunlu PETG Red",
  brand: "Sunlu",
  material: "PETG",
  colorName: "Red",
  colorRgba: "BC2726FF",
  nozzleTempMin: 255,
  nozzleTempMax: 255,
  density: 1.27,
  diameter: 1.75,
  slicerFilamentCode: "",
  filamentId: derivedFilamentId("Sunlu PETG Red"),
  labelWeight: 1000,
  coreWeight: 189,
};

function update(action: ColorFormAction): ColorFormState {
  if (action.type !== "update") throw new Error(`expected an update, got ${action.type}`);
  return action.state;
}

describe("colorVariant", () => {
  it("keeps everything of the listed color but its name, color and ID", () => {
    expect(colorVariant(RED, "Elite Mildewed Red", "AD0000FF")).toEqual({
      ...RED,
      name: "Sunlu PETG Elite Mildewed Red",
      colorName: "Elite Mildewed Red",
      colorRgba: "AD0000FF",
      filamentId: derivedFilamentId("Sunlu PETG Elite Mildewed Red"),
    });
  });

  it("names it after brand and material when the listed name doesn't end with its color", () => {
    expect(colorVariant({ ...RED, name: "Sunlu Something" }, "Teal", "008080FF").name).toBe(
      "Sunlu PETG Teal",
    );
  });

  it("drops a slicer filament code: that code belongs to the listed color", () => {
    expect(colorVariant({ ...RED, slicerFilamentCode: "GFG99" }, "Teal", "008080FF")).toMatchObject(
      { slicerFilamentCode: "" },
    );
  });
});

describe("colorFormInput", () => {
  const start = initialColorForm();

  it("starts on the listed color to base it on, and opens that list with enter", () => {
    expect(start.cursor).toBe(BASE_ROW);
    expect(colorFormInput(start, "", key({ return: true }))).toEqual({ type: "choose" });
  });

  it("types and erases the name and color on their rows", () => {
    let state = update(colorFormInput({ ...start, cursor: NAME_ROW }, "T", key()));
    state = update(colorFormInput(state, "e", key()));
    state = update(colorFormInput(state, "", key({ backspace: true })));
    expect(state.colorName).toBe("T");

    expect(update(colorFormInput({ ...start, cursor: HEX_ROW }, "#", key())).hex).toBe("#");
  });

  it("moves to the next row with enter on a text row, and adds with enter on Add", () => {
    expect(
      update(colorFormInput({ ...start, cursor: NAME_ROW }, "", key({ return: true }))).cursor,
    ).toBe(HEX_ROW);
    expect(
      update(colorFormInput({ ...start, cursor: HEX_ROW }, "", key({ return: true }))).cursor,
    ).toBe(ADD_ROW);
    expect(colorFormInput({ ...start, cursor: ADD_ROW }, "", key({ return: true }))).toEqual({
      type: "submit",
    });
  });

  it("moves with the arrows, within the rows", () => {
    expect(update(colorFormInput(start, "", key({ upArrow: true }))).cursor).toBe(BASE_ROW);
    expect(
      update(colorFormInput({ ...start, cursor: ADD_ROW }, "", key({ downArrow: true }))).cursor,
    ).toBe(ADD_ROW);
    expect(update(colorFormInput(start, "", key({ downArrow: true }))).cursor).toBe(NAME_ROW);
  });

  it("goes back with escape, and clears the error on the next key", () => {
    expect(colorFormInput(start, "", key({ escape: true }))).toEqual({ type: "back" });
    expect(
      update(colorFormInput({ ...start, error: "x" }, "", key({ downArrow: true }))).error,
    ).toBe("");
  });
});

describe("colorFormProfile", () => {
  const filled: ColorFormState = {
    ...initialColorForm(),
    base: RED,
    colorName: " Elite Mildewed Red ",
    hex: "#ad0000",
  };

  it("builds the new color from the form", () => {
    expect(colorFormProfile(filled, [RED])).toEqual({
      profile: colorVariant(RED, "Elite Mildewed Red", "AD0000FF"),
    });
    expect(colorFormProfile({ ...filled, hex: "AD0000" }, [RED])).toEqual({
      profile: colorVariant(RED, "Elite Mildewed Red", "AD0000FF"),
    });
  });

  it("explains what's missing or wrong", () => {
    expect(colorFormProfile({ ...filled, base: null }, [RED])).toEqual({
      error: "Choose the listed color it's like",
    });
    expect(colorFormProfile({ ...filled, colorName: " " }, [RED])).toEqual({
      error: "Type the color's name",
    });
    expect(colorFormProfile({ ...filled, hex: "red" }, [RED])).toEqual({
      error: "Type the color as 6 hex digits, such as AD0000",
    });
  });

  it("refuses a name that's already listed", () => {
    expect(colorFormProfile({ ...filled, colorName: "red" }, [RED])).toEqual({
      error: "Sunlu PETG red is already listed",
    });
  });
});
