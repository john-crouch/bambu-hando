// ABOUTME: Rendering tests for the plan table's columns.
// ABOUTME: Values longer than their column are truncated and still keep a gap before the next column.

import { ThemeProvider } from "@inkjs/ui";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

import type { FilamentProfile, Status } from "../src/models.js";
import type { ProfilePlan } from "../src/planPreview.js";
import {
  finishedProfiles,
  PlanNotes,
  PlanTable,
  presetPlanText,
  type RowProgress,
  RunProgress,
  spoolEasePlanText,
} from "../src/tui/PlanTable.js";
import { theme } from "../src/tui/theme.js";

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
    const { lastFrame } = render(
      <PlanTable profiles={[LONG]} progress={[]} activePresets={false} activeSpools={false} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/Acme Extraordinar\S*… +Acmecorp\S*… +PETG +230-240/);
    expect(frame).toContain("Nozzle°C");
  });
});

describe("statuses, while and after a run", () => {
  const renderStatuses = (
    profiles: FilamentProfile[],
    progress: RowProgress[],
    activeSpools = false,
  ) =>
    render(
      <PlanTable
        profiles={profiles}
        progress={progress}
        activePresets={false}
        activeSpools={activeSpools}
      />,
    );

  it("shows each status as a badge in its column", () => {
    const statuses: Status[] = ["written", "planned", "skipped", "failed"];
    const { lastFrame } = renderStatuses(
      statuses.map(() => LONG),
      statuses.map((status) => ({ preset: status, spool: status })),
    );

    const rows = (lastFrame() ?? "").split("\n").slice(1);
    for (const [index, status] of statuses.entries()) {
      const label = status.toUpperCase();
      expect(rows[index]).toMatch(new RegExp(`230-240 +P1234567 +140 g +${label} +${label}$`));
    }
  });

  it("starts the badges in the same column on every row", () => {
    const { lastFrame } = renderStatuses(
      [LONG, LONG],
      [
        { preset: "written", spool: "failed" },
        { preset: "skipped", spool: "planned" },
      ],
    );

    const [, first, second] = (lastFrame() ?? "").split("\n");
    expect(first?.indexOf("WRITTEN")).toBe(second?.indexOf("SKIPPED"));
    expect(first?.indexOf("FAILED")).toBe(second?.indexOf("PLANNED"));
  });

  it.each([80, 85])(
    "cuts only the name, then the brand, at %i columns, keeping a gap after each and the others whole",
    (columns) => {
      const { lastFrame } = render(
        <PlanTable
          profiles={[LONG]}
          progress={[{ preset: "written", spool: "skipped" }]}
          activePresets={false}
          activeSpools={false}
          columns={columns}
        />,
      );

      const [header = "", row = ""] = (lastFrame() ?? "").split("\n");
      expect(header.length).toBeLessThanOrEqual(columns);
      expect(row.length).toBeLessThanOrEqual(columns);
      // The name, cut, then a gap, then the brand.
      const brand = header.indexOf("Br");
      expect(header.slice(3, brand)).toMatch(/^Name +$/);
      expect(row.slice(3, brand)).toMatch(/^Acme \S*… $/);
      // The brand, cut, then a gap, then the material.
      const material = header.indexOf("Material");
      expect(header.slice(brand, material)).toMatch(/^Br\S* +$/);
      expect(row.slice(brand, material)).toMatch(/^Ac\S*… $/);
      expect(row.indexOf("PETG")).toBe(material);
      expect(row.slice(material)).toMatch(/^PETG +230-240 +P1234567 140 g +WRITTEN {5}SKIPPED$/);
      expect(header.slice(material)).toMatch(
        /^Material +Nozzle°C +Code +Empty +Preset +SpoolEase$/,
      );
      expect(row.indexOf("WRITTEN")).toBe(header.indexOf("Preset") + 1);
      expect(row.indexOf("SKIPPED")).toBe(header.indexOf("SpoolEase") + 1);
    },
  );

  it.each([72, 64])(
    "fits %i columns by cutting the status, material and temperature columns too, every cell keeping its gap",
    (columns) => {
      const { lastFrame } = render(
        <PlanTable
          profiles={[LONG]}
          progress={[{ preset: "written", spool: "skipped" }]}
          activePresets={false}
          activeSpools={false}
          columns={columns}
        />,
      );

      const [header = "", row = ""] = (lastFrame() ?? "").split("\n");
      expect(header.length).toBeLessThanOrEqual(columns);
      expect(row.length).toBeLessThanOrEqual(columns);
      // The code and empty weight stay whole, each followed by a gap, and the badges stay whole.
      expect(row).toMatch(/ P1234567 140 g +WRITTEN +SKIPPED$/);
      expect(row.indexOf("P1234567")).toBe(header.indexOf("Code"));
    },
  );

  it("clips rows at the terminal's width once every column is at its minimum", () => {
    const { lastFrame } = render(
      <PlanTable
        profiles={[LONG]}
        progress={[{ preset: "written", spool: "skipped" }]}
        activePresets={false}
        activeSpools={false}
        columns={50}
      />,
    );

    const lines = (lastFrame() ?? "").split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(50);
  });

  it("spins in the column a stage is working on, for rows without a status yet", () => {
    const { lastFrame, unmount } = renderStatuses(
      [LONG, LONG],
      [{ preset: "written", spool: "written" }, { preset: "written" }],
      true,
    );

    const [, done, working] = (lastFrame() ?? "").split("\n");
    expect(done).toMatch(/WRITTEN +WRITTEN$/);
    expect(working).toMatch(/WRITTEN +⠋ working$/);
    unmount();
  });
});

describe("run progress", () => {
  it("counts a profile finished once both its preset and its SpoolEase status are in", () => {
    const progress: RowProgress[] = [];
    progress[0] = { preset: "written", spool: "written" };
    progress[2] = { preset: "failed" };
    progress[3] = { preset: "skipped", spool: "failed" };

    expect(finishedProfiles(progress)).toBe(2);
    expect(finishedProfiles([])).toBe(0);
  });

  it("fills the bar with the share of statuses in, preset and SpoolEase each, and says how many profiles finished", async () => {
    const { lastFrame } = render(
      <ThemeProvider theme={theme}>
        <RunProgress
          progress={[{ preset: "written", spool: "written" }, { preset: "written" }, {}]}
          total={3}
        />
      </ThemeProvider>,
    );

    await vi.waitFor(() =>
      expect(lastFrame()).toBe(`${"▰".repeat(15)}${"▱".repeat(15)} 1/3 profiles finished`),
    );
  });

  it("moves the bar while presets are written, before any SpoolEase status is in", async () => {
    const { lastFrame } = render(
      <ThemeProvider theme={theme}>
        <RunProgress progress={[{ preset: "written" }, { preset: "written" }]} total={2} />
      </ThemeProvider>,
    );

    await vi.waitFor(() =>
      expect(lastFrame()).toBe(`${"▰".repeat(15)}${"▱".repeat(15)} 0/2 profiles finished`),
    );
  });

  it("shows an empty bar for a run with no profiles", async () => {
    const { lastFrame } = render(
      <ThemeProvider theme={theme}>
        <RunProgress progress={[]} total={0} />
      </ThemeProvider>,
    );

    await vi.waitFor(() => expect(lastFrame()).toBe(`${"▱".repeat(30)} 0/0 profiles finished`));
  });
});

describe("the plan, before a run", () => {
  const plan = (changes: Partial<ProfilePlan>): ProfilePlan => ({
    presets: 1,
    existingPresets: 0,
    nozzleRange: { low: LONG.nozzleTempMin, high: LONG.nozzleTempMax },
    filament: null,
    spool: null,
    ...changes,
  });

  it("says whether each profile's presets are new, kept or replaced", () => {
    expect(presetPlanText(plan({}), false).text).toBe("+ new");
    expect(presetPlanText(plan({ existingPresets: 1 }), false).text).toBe("= kept");
    expect(presetPlanText(plan({ existingPresets: 1 }), true).text).toBe("↻ replace");
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), false).text).toBe("1/2 kept");
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), true).text).toBe("1/2 replace");
  });

  it("says what SpoolEase gets: the custom filament row and the spool", () => {
    const update = {
      state: "update" as const,
      listed: "Old 190-210 °C",
      becomes: "New 200-220 °C",
    };
    expect(
      spoolEasePlanText(
        plan({ filament: { state: "new", listed: "", becomes: "" }, spool: "create" }),
      )?.text,
    ).toBe("add + spool");
    expect(spoolEasePlanText(plan({ filament: update, spool: "create" }))?.text).toBe(
      "update + spool",
    );
    expect(
      spoolEasePlanText(
        plan({ filament: { state: "same", listed: "", becomes: "" }, spool: "create" }),
      )?.text,
    ).toBe("spool");
    expect(
      spoolEasePlanText(
        plan({ filament: { state: "same", listed: "", becomes: "" }, spool: "exists" }),
      )?.text,
    ).toBe("has spool");
    expect(
      spoolEasePlanText(plan({ filament: { state: "same", listed: "", becomes: "" } }))?.text,
    ).toBe("listed");
    expect(spoolEasePlanText(plan({ filament: update }))?.text).toBe("update");
    expect(spoolEasePlanText(plan({}))).toBeNull();
  });

  it("shows the plan in the status columns until the run reports", () => {
    const plans = [
      plan({
        existingPresets: 1,
        filament: { state: "new", listed: "", becomes: "" },
        spool: "create",
      }),
    ];
    const { lastFrame } = render(
      <PlanTable
        profiles={[LONG]}
        progress={[]}
        plans={plans}
        overwrite={false}
        activePresets={false}
        activeSpools={false}
      />,
    );
    expect(lastFrame()).toMatch(/= kept +add \+ spool/);

    const running = render(
      <PlanTable
        profiles={[LONG]}
        progress={[{ preset: "skipped" }]}
        plans={plans}
        overwrite={false}
        activePresets={false}
        activeSpools
      />,
    );
    expect(running.lastFrame()).toContain("SKIPPED");
    expect(running.lastFrame()).not.toContain("add + spool");
  });

  it("shows the nozzle range the run gives SpoolEase, while it runs too", () => {
    const plans = [plan({ nozzleRange: { low: 235, high: 250 } })];
    const { lastFrame } = render(
      <PlanTable
        profiles={[LONG]}
        progress={[]}
        plans={plans}
        activePresets={false}
        activeSpools={false}
      />,
    );
    expect(lastFrame()).toMatch(/PETG +235-250/);

    const running = render(
      <PlanTable
        profiles={[LONG]}
        progress={[{ preset: "written" }]}
        plans={plans}
        activePresets={false}
        activeSpools
      />,
    );
    expect(running.lastFrame()).toMatch(/PETG +235-250/);
  });

  it("says which presets the plan's edits go into", () => {
    const edits = new Map([["P1234567", new Map([["filament_flow_ratio", { every: "0.95" }]])]]);

    const written = render(
      <PlanNotes
        profiles={[LONG]}
        plans={[plan({ presets: 2, existingPresets: 1 })]}
        overwrite={false}
        edits={edits}
      />,
    );
    expect(written.lastFrame()).toContain(
      "✎ P1234567: 1 change goes into the 1 preset the run writes",
    );

    const replaced = render(
      <PlanNotes
        profiles={[LONG]}
        plans={[plan({ presets: 2, existingPresets: 1 })]}
        overwrite
        edits={edits}
      />,
    );
    expect(replaced.lastFrame()).toContain(
      "✎ P1234567: 1 change goes into the 2 presets the run writes",
    );

    const kept = render(
      <PlanNotes
        profiles={[LONG]}
        plans={[plan({ existingPresets: 1 })]}
        overwrite={false}
        edits={edits}
      />,
    );
    expect(kept.lastFrame()).toContain(
      "✎ P1234567: the run keeps its presets, so its 1 change goes nowhere",
    );
  });

  it("explains updates, kept presets and existing spools under the table", () => {
    const plans = [
      plan({
        existingPresets: 1,
        filament: {
          state: "update",
          listed: "Acme Black 200-220 °C",
          becomes: "Acme Black 230-240 °C",
        },
        spool: "exists",
      }),
    ];
    const { lastFrame } = render(<PlanNotes profiles={[LONG]} plans={plans} overwrite={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "↻ P1234567 is Acme Black 200-220 °C on SpoolEase; the run changes it to Acme Black 230-240 °C",
    );
    expect(frame).toContain(
      "= kept: 1 preset is there already and stays as it is (Overwrite presets in Settings replaces it)",
    );
    expect(frame).toContain(
      "has spool: the console has a spool of 1 filament already, so it gets no new one",
    );
  });
});
