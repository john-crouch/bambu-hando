// ABOUTME: Rendering tests for the plan table's columns.
// ABOUTME: Values longer than their column are truncated and still keep a gap before the next column.

import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { PlanTable } from "../src/tui/PlanTable.js";

const LONG: FilamentProfile = {
  name: "Acme Extraordinarily Long Filament Name Black",
  brand: "Acmecorporation",
  material: "PETG",
  colorName: "Black",
  colorRgba: "000000FF",
  nozzleTempMin: 230,
  nozzleTempMax: 240,
  density: 1.27,
  diameter: 1.75,
  slicerFilamentCode: "",
  filamentId: "P1234567",
  labelWeight: 1000,
  coreWeight: 140,
};

describe("PlanTable", () => {
  it("keeps a gap after a value truncated to its column", () => {
    const { lastFrame } = render(<PlanTable profiles={[LONG]} progress={[]} activePresets={false} activeSpools={false} />);

    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/Acme Extraordinar\S*… +Acmecorp\S*… +PETG +230-240/);
    expect(frame).toContain("Nozzle°C");
  });
});
