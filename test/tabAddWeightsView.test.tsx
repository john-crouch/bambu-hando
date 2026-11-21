// ABOUTME: Render tests for Add's Weights page at 60x20 to 160x45: the radio marks the choice, prose wraps, nothing cut.
// ABOUTME: Each row says where its weight comes from (your list or SpoolEase's catalog); text never touches a border.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { parseSpoolWeightList } from "../src/spoolWeights.js";
import { press } from "../src/tui/core/keys.js";
import type { Ctx } from "../src/tui/core/types.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctx as baseCtx } from "./tabAddHarness.js";

const SPOOLS = {
  skipSpoolease: false,
  host: "10.0.0.5",
  securityKey: "SECRET",
  createSpools: true,
};

function sized(columns: number, rows: number): Ctx {
  return {
    ...baseCtx({ values: SPOOLS }),
    columns,
    rows,
    bodyColumns: columns,
    bodyRows: rows - 2,
  };
}

const ENTRIES = [
  ...parseSpoolWeightList("Acme weighed on my scale,151", true),
  ...parseSpoolWeightList(
    "Acme - Plastic - 220g,220,Acme - Plastic - 245g,245\r\nAcme - Cardboard - 140g,140",
  ),
];

/** Weights for Acme PLA Blue, read with these lists and remembered choices. */
function weights(c: Ctx, remembered = {}): AddModel {
  let [model] = addTab.init(c, { query: "" });
  for (const key of ["enter", "down", "enter", "down", "space", "right"])
    [model] = addTab.update(model, { type: "key", key: press(key) }, c);
  return addTab.update(
    model,
    {
      type: "add/weightsRead",
      signature: model.weights.signature,
      entries: ENTRIES,
      warnings: [],
      spooled: [],
      remembered,
    },
    c,
  )[0];
}

function screen(model: AddModel, c: Ctx): string[] {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <addTab.View model={model} ctx={c} />
    </ThemeProvider>,
    { columns: c.columns },
  );
  return stripVTControlCharacters(out).split("\n");
}

/** The words inside the panels, borders and line breaks gone. */
function prose(lines: string[]): string {
  return lines
    .map((line) => line.replace(/[│┃╭╮╰╯─]/g, " "))
    .join(" ")
    .replace(/\s+/g, " ");
}

describe.each([
  [60, 20],
  [80, 24],
  [120, 36],
  [160, 45],
])("Weights at %ix%i", (columns, rows) => {
  const c = sized(columns, rows);

  it("marks the preselected choice ● and the rest ○", () => {
    const lines = screen(weights(c), c);
    const chosen = lines.filter((line) => line.includes("●"));
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toContain("As listed in SpoolmanDB");
    expect(lines.filter((line) => line.includes("○")).length).toBeGreaterThan(1);
  });

  it("marks a remembered choice ●", () => {
    const lines = screen(weights(c, { acme: { kind: "grams", grams: 140 } }), c);
    expect(lines.filter((line) => line.includes("●"))).toEqual([
      expect.stringMatching(/Acme - Cardboard/),
    ]);
  });

  it("wraps the question instead of cutting it", () => {
    const text = prose(screen(weights(c), c));
    expect(text).toContain("SpoolEase lists several spools for this brand: which is yours?");
    expect(text).not.toMatch(/which is…/);
  });

  it("says where each weight comes from", () => {
    // From the top of the list, so the user's own row is in view even at 60x20.
    const model = weights(c);
    const lines = screen({ ...model, weights: { ...model.weights, cursor: 0 } }, c);
    const rows = lines.filter((line) => line.startsWith("│"));
    expect(rows.find((line) => line.includes("Acme weighed"))).toMatch(/your list/);
    const catalogRows = rows.filter((line) => /○ Acme - (Plastic|Cardboard)/.test(line));
    expect(catalogRows.length).toBeGreaterThan(0);
    for (const line of catalogRows) expect(line).toMatch(/catalog/);
  });

  it("keeps every line inside the terminal and off the borders", () => {
    const lines = screen(weights(c), c);
    for (const [index, line] of lines.entries()) {
      expect(textWidth(line), `line ${index}`).toBeLessThanOrEqual(columns);
      // A panel's text ends a column before its border (or the list's scroll thumb).
      for (const match of line.matchAll(/[^\s│┃╮╯─](?=│)/g))
        expect(match.index, `line ${index}: ${line}`).toBeUndefined();
    }
  });
});

describe("Weights with two brands to choose for", () => {
  it.each([
    [60, 20],
    [80, 24],
    [120, 36],
  ])("cuts nothing in the detail at %ix%i", (columns, rows) => {
    const c = sized(columns, rows);
    let [model] = addTab.init(c, { query: "" });
    // Acme PLA Blue, then Sunlu PLA White from the brands.
    for (const key of [
      "enter",
      "down",
      "enter",
      "down",
      "space",
      "esc",
      "esc",
      "down",
      "enter",
      "space",
      "right",
    ])
      [model] = addTab.update(model, { type: "key", key: press(key) }, c);
    [model] = addTab.update(
      model,
      {
        type: "add/weightsRead",
        signature: model.weights.signature,
        entries: [
          ...ENTRIES,
          ...parseSpoolWeightList("Sunlu - Plastic - 117g,117,Sunlu - Plastic - 150g,150"),
        ],
        warnings: [],
        spooled: [],
        remembered: {},
      },
      c,
    );
    expect(model.weights.prompts).toHaveLength(2);
    const lines = screen(model, c);
    // "choosing…" is the brand being chosen for; any other … is a cut.
    expect(lines.join("\n").replaceAll("choosing…", "")).not.toContain("…");
    const text = prose(lines);
    expect(text).toContain("Acme choosing…");
    expect(text).toContain("Sunlu to choose");
  });
});

describe("Weights in a narrow terminal", () => {
  it("leaves out where rows are from before it cuts a name", () => {
    const c = sized(60, 20);
    const model = weights(c);
    const long = parseSpoolWeightList("Acme PolyTerra PLA (Cardboard Spool) Deluxe - 147g,147");
    const [read] = addTab.update(
      model,
      {
        type: "add/weightsRead",
        signature: model.weights.signature,
        entries: [...ENTRIES, ...long],
        warnings: [],
        spooled: [],
        remembered: {},
      },
      c,
    );
    const lines = screen({ ...read, weights: { ...read.weights, cursor: 4 } }, c);
    expect(lines.join("\n")).toContain("Acme PolyTerra PLA (Cardboard Spool) Deluxe");
    for (const row of lines.filter((line) => /[○●] /.test(line)))
      expect(row).not.toContain("catalog");
  });
});
