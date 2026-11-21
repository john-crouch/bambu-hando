// ABOUTME: Render tests for every design-system component: text, colors cell by cell, and widths at 40, 80 and 120 columns.
// ABOUTME: Colors are forced on (FORCE_COLOR=3) and the frames parsed into styled cells, so a bar or a chip is checked where it's drawn.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { Box, renderToString, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import type { Hint } from "../src/tui/core/types.js";
import { Bar, barCells } from "../src/tui/ui/Bar.js";
import { Busy } from "../src/tui/ui/Busy.js";
import { Detail } from "../src/tui/ui/Detail.js";
import { Dialog, dialogInner, dialogWidth } from "../src/tui/ui/Dialog.js";
import { Empty } from "../src/tui/ui/Empty.js";
import { Footer, footerSegments } from "../src/tui/ui/Footer.js";
import { Frame, frameBody } from "../src/tui/ui/Frame.js";
import { Header, type HeaderStatus, headerLayout } from "../src/tui/ui/Header.js";
import { fitHints } from "../src/tui/ui/hints.js";
import { Line } from "../src/tui/ui/Line.js";
import { List } from "../src/tui/ui/List.js";
import type { ListRow } from "../src/tui/ui/list.js";
import { type Page, PageBar } from "../src/tui/ui/PageBar.js";
import { Panel, panelInner, splitWidths } from "../src/tui/ui/Panel.js";
import { luminance, Swatch } from "../src/tui/ui/Swatch.js";
import { TextField } from "../src/tui/ui/TextField.js";
import { TITLE, Title } from "../src/tui/ui/Title.js";
import { toastSegments } from "../src/tui/ui/Toast.js";
import { textWidth } from "../src/tui/ui/text.js";
import { COLORS, GRADIENT, theme } from "../src/tui/ui/theme.js";

const WIDTHS = [40, 80, 120] as const;

/** The node drawn by Ink at `columns`, inside the app's theme. */
function draw(node: ReactElement, columns = 120): string {
  return renderToString(<ThemeProvider theme={theme}>{node}</ThemeProvider>, { columns });
}

const plain = (frame: string): string[] => stripVTControlCharacters(frame).split("\n");

interface StyledCell {
  ch: string;
  fg?: string;
  bg?: string;
  bold: boolean;
  dim: boolean;
  inverse: boolean;
}

const hex = (r: string, g: string, b: string): string =>
  `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One line of a frame as cells with the style each is drawn in. Colors: "#RRGGBB", or "sgr<n>" for named ones. */
function cells(line: string): StyledCell[] {
  const out: StyledCell[] = [];
  const state: Omit<StyledCell, "ch"> = { bold: false, dim: false, inverse: false };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: parsing escape sequences is the point.
  const token = /\u001B\[([0-9;]*)m|\u001B\]8;[^\u0007\u001B]*(?:\u0007|\u001B\\)|([^\u001B]+)/g;
  for (const match of line.matchAll(token)) {
    if (match[2] !== undefined) {
      for (const { segment } of graphemes.segment(match[2])) {
        out.push({ ch: segment, ...state });
      }
      continue;
    }
    if (match[1] === undefined) continue;
    const codes = match[1] === "" ? ["0"] : match[1].split(";");
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i]);
      if (code === 0) {
        delete state.fg;
        delete state.bg;
        state.bold = state.dim = state.inverse = false;
      } else if (code === 1) state.bold = true;
      else if (code === 2) state.dim = true;
      else if (code === 22) state.bold = state.dim = false;
      else if (code === 7) state.inverse = true;
      else if (code === 27) state.inverse = false;
      else if (code === 39) delete state.fg;
      else if (code === 49) delete state.bg;
      else if (code === 38 || code === 48) {
        const value =
          codes[i + 1] === "2"
            ? hex(codes[i + 2] ?? "0", codes[i + 3] ?? "0", codes[i + 4] ?? "0")
            : `sgr${code}:5:${codes[i + 2]}`;
        i += codes[i + 1] === "2" ? 4 : 2;
        if (code === 38) state.fg = value;
        else state.bg = value;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) state.fg = `sgr${code}`;
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) state.bg = `sgr${code}`;
    }
  }
  return out;
}

/** Every line of the frame is at most `width` columns. */
function expectWithin(frame: string, width: number): void {
  for (const [index, line] of plain(frame).entries()) {
    expect(textWidth(line), `line ${index}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
  }
}

const GRAY = "sgr90";

const HINTS: Hint[] = [
  { keys: "↑↓", label: "move", primary: true },
  { keys: "space", label: "tick", primary: true },
  { keys: "/", label: "filter" },
  { keys: "s", label: "sort" },
  { keys: "l", label: "label", primary: true },
  { keys: "?", label: "help", primary: true },
];

const GLOBAL: Hint[] = [
  { keys: "tab", label: "next tab" },
  { keys: "?", label: "help", primary: true },
  { keys: "q", label: "quit" },
];

const TABS = [
  { id: "spools", title: "Spools" },
  { id: "add", title: "Add" },
  { id: "presets", title: "Presets" },
  { id: "check", title: "Check", badge: 3 },
  { id: "settings", title: "Settings" },
];

const STATUS: HeaderStatus = {
  console: "ok",
  consoleText: "SpoolEase 10.0.24.111",
  printerText: "X1C 0.6",
};

const NAMES = [
  "Sunlu PETG 2.0 Vivid Yellow",
  "OVERTURE PLA Basic White",
  "OVERTURE PETG Basic Black",
  "Polymaker PolyLite™ PLA Galaxy Dark Blue with a very long product name",
];
const CHIPS = ["#FFD700", "#FFFFFF", "#000000", "#1E2A78"];

function spoolRows(count: number): ListRow[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `s${i}`,
    ticked: i % 4 === 1,
    swatch: CHIPS[i % 4] ?? "#FFFFFF",
    cells: [
      { text: `#${count - i}`, width: 4, dim: true },
      { text: NAMES[i % 4] ?? "", grow: true },
      { text: `${(i * 97) % 1000} g`, width: 6, align: "right" as const },
      { text: "▰▰▰▱▱", width: 5, color: COLORS.ok },
    ],
  }));
}

describe("theme", () => {
  it("has every color the design names, and the gradient runs from accent 2 to accent", () => {
    for (const key of [
      "accent",
      "accent2",
      "ok",
      "warning",
      "failed",
      "muted",
      "selection",
      "selectionText",
      "border",
    ] as const) {
      expect(COLORS[key]).toBeTruthy();
    }
    expect(COLORS.accent).toBe("#A06BFF");
    expect(COLORS.accent2).toBe("#FF5F87");
    expect(COLORS.selection).toBe("#3B2F5C");
    expect(GRADIENT).toEqual([COLORS.accent2, COLORS.accent]);
  });
});

describe("Title", () => {
  it("shows the text unchanged, bold, in the gradient", () => {
    const frame = draw(<Title />);
    expect(plain(frame)[0]).toBe(TITLE);
    const colored = cells(frame.split("\n")[0] ?? "").filter((c) => c.fg);
    expect(colored[0]?.fg).toBe("#FF5F87");
    expect(colored.at(-1)?.fg).toBe("#A06BFF");
    expect(colored.every((c) => c.bold)).toBe(true);
  });
});

describe("Busy", () => {
  it("shows a one-column spinner frame beside the message", () => {
    const { lastFrame, unmount } = render(<Busy message="Reading spools…" />);
    expect(stripVTControlCharacters(lastFrame() ?? "")).toBe("⠋ Reading spools…");
    unmount();
  });
});

describe("Bar", () => {
  it("fills cells by fraction, at least one for anything, all only when full", () => {
    expect(barCells(0, 10)).toBe(0);
    expect(barCells(0.001, 10)).toBe(1);
    expect(barCells(0.56, 10)).toBe(6);
    expect(barCells(0.999, 10)).toBe(9);
    expect(barCells(1, 10)).toBe(10);
    expect(barCells(3, 10)).toBe(10);
    expect(barCells(Number.NaN, 10)).toBe(0);
    expect(barCells(0.5, 0)).toBe(0);
  });

  it("draws filled cells in the tone and the rest muted", () => {
    const frame = draw(<Bar fraction={0.4} width={10} tone="warning" />);
    expect(plain(frame)[0]).toBe("▰▰▰▰▱▱▱▱▱▱");
    const row = cells(frame);
    expect(row.slice(0, 4).every((c) => c.fg === COLORS.warning)).toBe(true);
    expect(row.slice(4).every((c) => c.fg === GRAY)).toBe(true);
  });
});

describe("Swatch", () => {
  it("is a block of the color, width by height", () => {
    const frame = draw(<Swatch color="#FFD700" width={6} height={2} />);
    const lines = frame.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const row = cells(line);
      expect(row).toHaveLength(6);
      expect(row.every((c) => c.bg === "#FFD700" && c.ch === " ")).toBe(true);
    }
  });

  it("gives a near-black chip gray edges, so it shows on a dark terminal", () => {
    const row = cells(draw(<Swatch color="#000000" width={4} />));
    expect(row.map((c) => c.ch).join("")).toBe("▕  ▏");
    expect(row.every((c) => c.bg === "#000000")).toBe(true);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(luminance("red")).toBeUndefined();
  });
});

describe("Panel", () => {
  it("sets the title and subtitle into the top border and the note into the bottom one", () => {
    const lines = plain(
      draw(
        <Panel title="Spools" subtitle="14 on the console" width={40} height={4} footerRight="3/14">
          <Text>hello</Text>
        </Panel>,
      ),
    );
    expect(lines).toEqual([
      "╭ Spools · 14 on the console ──────────╮",
      "│hello                                 │",
      "│                                      │",
      "╰─────────────────────────────── 3/14 ─╯",
    ]);
  });

  it("is exactly its size, clipping children that don't fit", () => {
    const lines = plain(
      draw(
        <Panel title="Spools" width={30} height={4}>
          {["a", "b", "c", "d", "e"].map((t) => (
            <Text key={t}>{t}</Text>
          ))}
        </Panel>,
      ),
    );
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => textWidth(line))).toEqual([30, 30, 30, 30]);
    expect(lines[2]).toBe(`│b${" ".repeat(27)}│`);
  });

  it("cuts the subtitle first, then the title, always leaving a ─ before the corner", () => {
    const at = (width: number) =>
      plain(
        draw(<Panel title="Spools" subtitle="14 on the console" width={width} height={2} />),
      )[0];
    expect(at(24)).toBe("╭ Spools · 14 on the… ─╮");
    expect(at(14)).toBe("╭ Spools ────╮");
    expect(at(10)).toBe("╭ Spoo… ─╮");
    expect(at(5)).toBe("╭───╮");
  });

  it("draws the border and title in accent when focused, dim gray otherwise", () => {
    const top = (focused: boolean) =>
      cells(
        draw(<Panel title="Spools" focused={focused} width={20} height={2} />).split("\n")[0] ?? "",
      );
    const focused = top(true);
    expect(focused[0]?.fg).toBe(COLORS.accent);
    expect(focused[2]).toMatchObject({ ch: "S", fg: COLORS.accent, bold: true });
    const idle = top(false);
    expect(idle[0]?.fg).toBe(GRAY);
    expect(idle[2]).toMatchObject({ ch: "S", fg: GRAY, bold: false });
  });

  it("without a width, takes its share of the row, never past it, with whole borders", () => {
    for (const total of [40, 41, 60, 61, 80, 120]) {
      const lines = plain(
        draw(
          <Box width={total}>
            <Panel title="Left" grow height={3} footerRight="3/14">
              <Text>a</Text>
            </Panel>
            <Panel title="Right" grow height={3} focused>
              <Text>b</Text>
            </Panel>
          </Box>,
          total,
        ),
      );
      expect(lines.map((line) => textWidth(line))).toEqual([total, total, total]);
      expect(lines[0]).toMatch(/^╭ Left ─+╮╭ Right ─+╮$/);
      expect(lines[1]).toMatch(/^│a +││b +│$/);
      expect(lines[2]).toMatch(/^╰─+ 3\/14 ─╯╰─+╯$/);
    }
  });

  it("splits a row into whole-column widths by weight", () => {
    expect(splitWidths(80, [3, 2])).toEqual([48, 32]);
    expect(splitWidths(81, [1, 1])).toEqual([41, 40]);
    expect(splitWidths(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitWidths(0, [1, 1])).toEqual([0, 0]);
    expect(splitWidths(10, [0, 0])).toEqual([0, 0]);
    for (const total of [40, 79, 80, 120]) {
      expect(splitWidths(total, [0.6, 0.4]).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("gives its children the inside: one column and row of border each side", () => {
    expect(panelInner(40, 20)).toEqual({ width: 38, height: 18 });
    expect(panelInner(1, 1)).toEqual({ width: 0, height: 0 });
  });
});

describe("List", () => {
  const rows = spoolRows(30);

  it("shows the window around the cursor, one line per row", () => {
    const lines = plain(draw(<List rows={rows} cursor={20} height={5} width={60} />));
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.slice(4, 7))).toEqual(["#12", "#11", "#10", "#9 ", "#8 "]);
  });

  it("draws the cursor's row as a selection bar across the whole width, ▌ in accent at its start", () => {
    const frame = draw(<List rows={rows} cursor={0} height={3} width={60} marker="check" />);
    const bar = cells(frame.split("\n")[0] ?? "");
    expect(bar).toHaveLength(60);
    expect(bar[0]).toMatchObject({ ch: "▌", fg: COLORS.accent });
    const chip = new Set([5, 6]);
    bar.forEach((cell, index) => {
      expect(cell.bg, `column ${index}`).toBe(chip.has(index) ? "#FFD700" : COLORS.selection);
    });
    // Other rows have no bar.
    const next = cells(frame.split("\n")[1] ?? "");
    expect(next.filter((c) => c.bg === COLORS.selection)).toHaveLength(0);
  });

  it("draws the name bold in the selection's text color on the bar", () => {
    const bar = cells(
      draw(<List rows={rows} cursor={0} height={1} width={60} />).split("\n")[0] ?? "",
    );
    const name = bar.find((c) => c.ch === "S");
    expect(name).toMatchObject({ fg: COLORS.selectionText, bold: true, bg: COLORS.selection });
  });

  it("keeps dim cells dim on the bar, not bold", () => {
    const bar = cells(
      draw(<List rows={rows} cursor={0} height={1} width={60} />).split("\n")[0] ?? "",
    );
    const id = bar.find((c) => c.ch === "#");
    expect(id).toMatchObject({ dim: true, bold: false, bg: COLORS.selection });
  });

  it("keeps a quieter bar without the ▌ when the list isn't focused", () => {
    const bar = cells(
      draw(<List rows={rows} cursor={0} height={1} width={40} focused={false} />).split("\n")[0] ??
        "",
    );
    expect(bar[0]?.ch).toBe(" ");
    expect(bar[10]?.bg).toBeDefined();
    expect(bar[10]?.bg).not.toBe(COLORS.selection);
  });

  it("ticks with [✓] in green and leaves [ ] for the rest", () => {
    const lines = draw(<List rows={rows} cursor={5} height={3} width={60} marker="check" />).split(
      "\n",
    );
    expect(plain(lines.join("\n")).map((line) => line.slice(1, 4))).toEqual(["[ ]", "[✓]", "[ ]"]);
    expect(cells(lines[1] ?? "")[2]).toMatchObject({ ch: "✓", fg: COLORS.ok });
  });

  it("draws chips in the row's color, two columns wide", () => {
    const line = draw(<List rows={rows} cursor={8} height={1} width={60} />).split("\n")[0] ?? "";
    const row = cells(line);
    expect(row.slice(1, 3).every((c) => c.bg === "#FFD700")).toBe(true);
    expect(row[3]?.bg).not.toBe("#FFD700");
  });

  it("aligns a right-aligned cell to its right edge", () => {
    const line = plain(draw(<List rows={rows} cursor={0} height={1} width={60} />))[0] ?? "";
    expect(line).toContain("   0 g ▰▰▰▱▱");
  });

  it("highlights the filter's words in accent 2 in every cell", () => {
    const line =
      draw(<List rows={rows} cursor={9} height={1} width={60} highlight="petg sun" />).split(
        "\n",
      )[0] ?? "";
    const row = cells(line);
    const text = row.map((c) => c.ch).join("");
    const at = text.indexOf("Sunlu");
    expect(row.slice(at, at + 3).every((c) => c.fg === COLORS.accent2 && c.bold)).toBe(true);
    expect(row[at + 3]?.fg).not.toBe(COLORS.accent2);
    const petg = text.indexOf("PETG");
    expect(row.slice(petg, petg + 4).every((c) => c.fg === COLORS.accent2)).toBe(true);
  });

  it("cuts long names with … and drops trailing columns before the name when narrow", () => {
    const wide = plain(draw(<List rows={rows} cursor={0} height={4} width={60} />));
    expect(wide[3]).toContain("Polymaker PolyLite™ PLA Galaxy Dark…  291 g");
    const narrow = plain(draw(<List rows={rows} cursor={0} height={4} width={24} />));
    expect(narrow[0]).toBe("▌   #30  Sunlu PETG 2… ┃");
    expect(narrow[0]).not.toContain("g");
  });

  it("draws a scroll thumb in the last column when the rows don't all fit", () => {
    const last = (frame: string) =>
      frame.split("\n").map((line) => {
        const row = cells(line);
        return row.length === 40 ? row[39]?.ch : " ";
      });
    expect(last(draw(<List rows={rows} cursor={2} height={6} width={40} />))).toEqual([
      "┃",
      " ",
      " ",
      " ",
      " ",
      " ",
    ]);
    expect(last(draw(<List rows={rows.slice(0, 3)} cursor={0} height={6} width={40} />))).toEqual([
      " ",
      " ",
      " ",
    ]);
  });

  it("leaves a gap column before the scroll thumb, so no text touches it", () => {
    const frame = draw(<List rows={rows} cursor={0} height={4} width={40} />);
    // Ink trims trailing spaces: pad back to the width before reading the gap column.
    for (const line of plain(frame)) expect(line.padEnd(40)[38]).toBe(" ");
  });

  it("draws nothing for no rows", () => {
    expect(plain(draw(<List rows={[]} cursor={0} height={5} width={40} />))).toEqual([""]);
  });

  it.each(WIDTHS)(
    "draws every row within %i columns, the cursor's bar exactly that wide",
    (width) => {
      for (const marker of ["check", "none"] as const) {
        const frame = draw(
          <List rows={rows} cursor={3} height={10} width={width} marker={marker} highlight="pla" />,
          width + 10,
        );
        const lines = frame.split("\n");
        expect(lines).toHaveLength(10);
        for (const line of lines) expect(cells(line).length).toBeLessThanOrEqual(width);
        const bar = lines.find((line) => line.includes("▌")) ?? "";
        expect(cells(bar)).toHaveLength(width);
      }
    },
  );
});

describe("Detail", () => {
  const rows = [
    { label: "Name", value: "Sunlu PETG 2.0 Vivid Yellow" },
    { label: "Left", value: "564 g of 1000 g  56%", tone: "ok" as const },
    { label: "", value: "" },
    { label: "Filament ID", value: "P4840583", dim: true },
  ];

  it("aligns values after the widest label, with a blank line for an empty row", () => {
    expect(plain(draw(<Detail rows={rows} width={50} />)).map((line) => line.trimEnd())).toEqual([
      " Name         Sunlu PETG 2.0 Vivid Yellow",
      " Left         564 g of 1000 g  56%",
      "",
      " Filament ID  P4840583",
    ]);
  });

  it("draws labels muted and values in their tone", () => {
    const lines = draw(<Detail rows={rows} width={50} />).split("\n");
    const left = cells(lines[1] ?? "");
    expect(left[1]).toMatchObject({ ch: "L", fg: GRAY });
    expect(left[14]).toMatchObject({ ch: "5", fg: COLORS.ok });
    expect(cells(lines[3] ?? "")[14]).toMatchObject({ ch: "P", dim: true });
  });

  it("takes a label width, and cuts long values with …", () => {
    const lines = plain(draw(<Detail rows={rows.slice(0, 1)} width={20} labelWidth={6} />));
    expect(lines[0]).toBe(" Name    Sunlu PET…");
  });

  it.each(WIDTHS)("never draws past %i columns", (width) => {
    const lines = draw(<Detail rows={rows} width={width} />, width + 10).split("\n");
    for (const line of lines) expect(cells(line).length).toBeLessThanOrEqual(width);
  });
});

describe("PageBar", () => {
  const pages: Page[] = [
    { id: "find", title: "Find", state: "done" },
    { id: "weights", title: "Weights", state: "current", badge: 2 },
    { id: "review", title: "Review", state: "todo" },
    { id: "done", title: "Done", state: "disabled" },
  ];

  it("joins the pages with ─, done ticked, current marked ▸ in accent", () => {
    const frame = draw(<PageBar pages={pages} width={60} />);
    expect(plain(frame)[0]?.trimEnd()).toBe(" ✓ Find ─ ▸ Weights 2 ─ Review ─ Done");
    const row = cells(frame);
    expect(row[1]).toMatchObject({ ch: "✓", fg: COLORS.ok });
    const current = row.findIndex((c) => c.ch === "▸");
    expect(row[current]).toMatchObject({ fg: COLORS.accent, bold: true });
    const badge = row.findIndex((c) => c.ch === "2");
    expect(row[badge]?.fg).toBe(COLORS.warning);
  });

  it("keeps a column free before the border, else shows the pages around the current one, else only it", () => {
    // The whole bar is 37 columns: 38 leaves one free at the right.
    expect(plain(draw(<PageBar pages={pages} width={38} />))[0]?.trimEnd()).toBe(
      " ✓ Find ─ ▸ Weights 2 ─ Review ─ Done",
    );
    expect(plain(draw(<PageBar pages={pages} width={37} />))[0]?.trimEnd()).toBe(
      " … ─ ▸ Weights 2 ─ Review ─ …  2/4",
    );
    expect(plain(draw(<PageBar pages={pages} width={30} />))[0]?.trimEnd()).toBe(
      " ▸ Weights 2  2/4",
    );
    expect(plain(draw(<PageBar pages={pages} width={20} />))[0]?.trimEnd()).toBe(
      " ▸ Weights 2  2/4",
    );
  });

  it.each(WIDTHS)("never draws past %i columns", (width) => {
    expectWithin(draw(<PageBar pages={pages} width={width} />, width + 10), width);
    expectWithin(draw(<PageBar pages={pages} width={8} />, width), 8);
  });
});

describe("Footer", () => {
  it("lists every hint when they fit: key in accent 2, meaning muted, two spaces apart", () => {
    const frame = draw(<Footer hints={HINTS} columns={80} />, 80);
    expect(plain(frame)[0]?.trimEnd()).toBe(
      " ↑↓ move  space tick  / filter  s sort  l label  ? help",
    );
    const row = cells(frame);
    expect(row[1]).toMatchObject({ ch: "↑", fg: COLORS.accent2, bold: true });
    expect(row[4]).toMatchObject({ ch: "m", fg: GRAY });
  });

  it("keeps the primary hints, in order, when narrow", () => {
    expect(fitHints(HINTS, 46).map((hint) => hint.keys)).toEqual(["↑↓", "space", "/", "l", "?"]);
    expect(fitHints(HINTS, 40).map((hint) => hint.keys)).toEqual(["↑↓", "space", "l", "?"]);
    expect(fitHints(HINTS, 30).map((hint) => hint.keys)).toEqual(["↑↓", "space", "l"]);
    expect(fitHints(HINTS, 12).map((hint) => hint.keys)).toEqual(["↑↓"]);
  });

  it("puts the global keys at the right end, always keeping the primary ones", () => {
    const own = HINTS.filter((hint) => hint.keys !== "?");
    const line = (width: number) =>
      footerSegments(own, width, GLOBAL)
        .map((s) => s.text)
        .join("");
    expect(line(100)).toBe(
      ` ↑↓ move  space tick  / filter  s sort  l label${" ".repeat(24)}tab next tab  ? help  q quit `,
    );
    // Narrow: the tab's own keys give way first, the pinned ? help stays at the right end.
    expect(line(50)).toBe(" ↑↓ move  space tick  / filter  l label    ? help ");
    expect(line(24)).toBe(" ↑↓ move         ? help ");
  });

  it("puts a toast nowhere: the frame draws it", () => {
    expect(footerSegments(HINTS, 80).some((s) => s.bold && s.text.startsWith("✓"))).toBe(false);
  });

  it.each(WIDTHS)("is exactly %i columns", (width) => {
    for (const global of [[], GLOBAL]) {
      const segments = footerSegments(HINTS, width, global);
      expect(textWidth(segments.map((s) => s.text).join(""))).toBe(width);
      expectWithin(draw(<Footer hints={HINTS} global={global} columns={width} />, width), width);
    }
  });
});

describe("Toast", () => {
  it("draws its icon from its tone, ok by default, with a space each side", () => {
    const icon = (toast: Parameters<typeof toastSegments>[0]) => {
      const text = toastSegments(toast, 40).find((segment) => segment.bold);
      return [text?.text, text?.color];
    };
    expect(icon({ text: "Saved" })).toEqual(["✓ Saved", COLORS.ok]);
    expect(icon({ text: "Saved", tone: "ok" })).toEqual(["✓ Saved", COLORS.ok]);
    expect(icon({ text: "Console slow", tone: "warning" })).toEqual([
      "! Console slow",
      COLORS.warning,
    ]);
    expect(icon({ text: "Print failed", tone: "failed" })).toEqual([
      "✗ Print failed",
      COLORS.failed,
    ]);
    expect(
      toastSegments({ text: "Saved" }, 40)
        .map((s) => s.text)
        .join(""),
    ).toBe(" ✓ Saved ");
  });

  it("cuts a toast longer than its room", () => {
    const text = toastSegments({ text: "a very long message that cannot fit", tone: "failed" }, 20)
      .map((s) => s.text)
      .join("");
    expect(text).toBe(" ✗ a very long mes… ");
    expect(textWidth(text)).toBe(20);
  });
});

describe("Header", () => {
  it("shows the name, the tabs and the console's state with the printer when there's room", () => {
    const line =
      plain(draw(<Header tabs={TABS} active="spools" status={STATUS} columns={120} />))[0] ?? "";
    expect(line).toMatch(
      /^ bambu-hando {3}Spools {2}Add {2}Presets {2}Check 3 {2}Settings +✓ SpoolEase 10\.0\.24\.111 · X1C 0\.6$/,
    );
    expect(textWidth(line)).toBe(119);
  });

  it("fills the active tab as an accent pill and mutes the others", () => {
    const frame = draw(<Header tabs={TABS} active="presets" status={STATUS} columns={120} />);
    const row = cells(frame);
    const text = row.map((c) => c.ch).join("");
    const at = text.indexOf("Presets");
    expect(row.slice(at - 1, at + 8).every((c) => c.bg === COLORS.accent)).toBe(true);
    expect(row[at]).toMatchObject({ fg: COLORS.selectionText, bold: true });
    expect(row[text.indexOf("Add")]?.fg).toBe(GRAY);
    expect(row[text.indexOf("3")]?.fg).toBe(COLORS.warning);
  });

  it("drops the printer, then the console text, then the name as it narrows", () => {
    expect(headerLayout(TABS, "spools", STATUS, 120).status).toBe("full");
    expect(headerLayout(TABS, "spools", STATUS, 80)).toEqual({
      name: true,
      compact: false,
      status: "console",
    });
    expect(headerLayout(TABS, "spools", STATUS, 60)).toEqual({
      name: true,
      compact: false,
      status: "icon",
    });
    expect(headerLayout(TABS, "spools", STATUS, 53)).toEqual({
      name: true,
      compact: true,
      status: "icon",
    });
    expect(headerLayout(TABS, "spools", STATUS, 40)).toEqual({
      name: false,
      compact: true,
      status: "icon",
    });
    expect(
      plain(draw(<Header tabs={TABS} active="spools" status={STATUS} columns={40} />, 40))[0],
    ).toBe("  Spools Add Presets Check 3 Settings ✓");
  });

  it("marks a failed console ✗ in red, a skipped one -, and spins while checking", () => {
    const row = (console: HeaderStatus["console"]) =>
      cells(
        draw(<Header tabs={TABS} active="spools" status={{ ...STATUS, console }} columns={120} />),
      );
    const icon = (console: HeaderStatus["console"]) => {
      const r = row(console);
      return r[
        r
          .map((c) => c.ch)
          .join("")
          .indexOf(" SpoolEase") - 1
      ];
    };
    expect(icon("failed")).toMatchObject({ ch: "✗", fg: COLORS.failed });
    expect(icon("skipped")).toMatchObject({ ch: "-", fg: GRAY });
    expect(icon("checking")).toMatchObject({ ch: "⠋", fg: COLORS.accent });
  });

  it.each([...WIDTHS, 20, 30, 55, 70, 90, 100])("never draws past %i columns", (width) => {
    expectWithin(
      draw(<Header tabs={TABS} active="check" status={STATUS} columns={width} />, width),
      width,
    );
  });
});

describe("TextField", () => {
  it("shows the cursor as a reversed cell", () => {
    const row = cells(draw(<TextField value="PETG" cursor={1} focused width={10} />));
    expect(
      row
        .map((c) => c.ch)
        .join("")
        .trimEnd(),
    ).toBe("PETG");
    expect(row[1]).toMatchObject({ ch: "E", inverse: true });
    expect(row.filter((c) => c.inverse)).toHaveLength(1);
  });

  it("puts the cursor after the end as a reversed space, and hides it when not focused", () => {
    const row = cells(draw(<TextField value="PETG" cursor={4} focused width={10} />));
    expect(row[4]).toMatchObject({ ch: " ", inverse: true });
    const idle = cells(draw(<TextField value="PETG" cursor={4} focused={false} width={10} />));
    expect(idle.filter((c) => c.inverse)).toHaveLength(0);
  });

  it("shows the placeholder muted when empty", () => {
    const row = cells(
      draw(<TextField value="" cursor={0} focused placeholder="Brand or name" width={20} />),
    );
    expect(row[0]).toMatchObject({ ch: " ", inverse: true });
    expect(
      row
        .slice(1)
        .map((c) => c.ch)
        .join("")
        .trimEnd(),
    ).toBe("Brand or name");
    expect(row[1]?.fg).toBe(GRAY);
  });

  it("masks a security key, never drawing a character of it", () => {
    const frame = draw(<TextField value="s3cr3t-key" cursor={10} focused mask width={20} />);
    expect(plain(frame)[0]?.trimEnd()).toBe("••••••••••");
    expect(frame).not.toContain("s3cr3t");
  });

  it("scrolls a long value with … on the hidden side", () => {
    const value = "Polymaker PolyLite PLA Galaxy Dark Blue";
    expect(
      plain(draw(<TextField value={value} cursor={value.length} focused width={16} />))[0],
    ).toBe("…laxy Dark Blue ");
    expect(plain(draw(<TextField value={value} cursor={0} focused width={16} />))[0]).toBe(
      "Polymaker PolyL…",
    );
  });

  it.each(WIDTHS)("never draws past %i columns", (width) => {
    const value = "x".repeat(200);
    for (const cursor of [0, 100, 200]) {
      expectWithin(
        draw(<TextField value={value} cursor={cursor} focused width={width} />, width + 10),
        width,
      );
    }
  });
});

describe("Empty", () => {
  it("centers its title, lines and action in its area", () => {
    const lines = plain(
      draw(
        <Empty
          title="No console yet"
          lines={["Spools come from your SpoolEase console."]}
          action={{ keys: "tab", label: "Settings" }}
          width={50}
          height={9}
        />,
      ),
    );
    expect(lines).toEqual([
      "",
      "",
      "                  No console yet",
      "",
      "     Spools come from your SpoolEase console.",
      "",
      "                   tab Settings",
      "",
      "",
    ]);
  });

  it("cuts lines wider than its area", () => {
    const lines = plain(
      draw(<Empty title="A title much too long for this" width={12} height={1} />),
    );
    expect(lines).toEqual(["A title muc…"]);
  });
});

describe("Dialog", () => {
  it("draws an accent box with the title in its border and its content; its keys go in the footer", () => {
    const frame = draw(
      <Dialog title="More spools like #14" width={36}>
        <Text>How many?</Text>
      </Dialog>,
    );
    expect(plain(frame)).toEqual([
      "╭ More spools like #14 ────────────╮",
      "│                                  │",
      "│  How many?                       │",
      "│                                  │",
      "╰──────────────────────────────────╯",
    ]);
    expect(cells(frame.split("\n")[0] ?? "")[0]?.fg).toBe(COLORS.accent);
  });

  it("is as wide as it wants, or the whole width when that would leave slivers at the sides", () => {
    expect(dialogWidth(120, 76)).toBe(76);
    expect(dialogWidth(80, 40)).toBe(40);
    expect(dialogWidth(80, 76)).toBe(80);
    expect(dialogWidth(60, 56)).toBe(60);
    expect(dialogWidth(30, 56)).toBe(30);
  });

  it("sets a note into its bottom border", () => {
    const frame = draw(
      <Dialog title="Help" width={24} note="↓ more">
        <Text>Keys</Text>
      </Dialog>,
    );
    expect(plain(frame).at(-1)).toBe(`╰${"─".repeat(13)} ↓ more ─╯`);
  });

  it("still draws a key line when it's given hints", () => {
    const frame = draw(
      <Dialog
        title="More spools like #14"
        width={36}
        hints={[
          { keys: "a", label: "apply" },
          { keys: "esc", label: "cancel" },
        ]}
      >
        <Text>How many?</Text>
      </Dialog>,
    );
    expect(plain(frame)).toEqual([
      "╭ More spools like #14 ────────────╮",
      "│                                  │",
      "│  How many?                       │",
      "│                                  │",
      "│  a apply  esc cancel             │",
      "│                                  │",
      "╰──────────────────────────────────╯",
    ]);
    expect(cells(frame.split("\n")[0] ?? "")[0]?.fg).toBe(COLORS.accent);
    expect(dialogInner(36)).toBe(30);
  });

  it("covers whatever is under it", () => {
    const body = Array.from({ length: 10 }, () => "x".repeat(40)).join("\n");
    const lines = plain(
      draw(
        <Frame
          columns={40}
          rows={12}
          header={<Text>head</Text>}
          footer={<Text>foot</Text>}
          overlay={
            <Dialog title="Hi" width={20} hints={[]}>
              <Text>ok</Text>
            </Dialog>
          }
        >
          <Text>{body}</Text>
        </Frame>,
        40,
      ),
    );
    const top = lines.findIndex((line) => line.includes("╭ Hi"));
    expect(top).toBeGreaterThan(0);
    expect(lines[top + 2]).toBe(`${"x".repeat(10)}│  ok              │${"x".repeat(10)}`);
    expect(lines[top + 1]).toBe(`${"x".repeat(10)}│                  │${"x".repeat(10)}`);
  });
});

describe("Frame", () => {
  it("is the terminal's size: header on the first line, footer on the last, body between", () => {
    const lines = plain(
      draw(
        <Frame columns={40} rows={6} header={<Text>head</Text>} footer={<Text>foot</Text>}>
          <Text>body</Text>
        </Frame>,
        40,
      ),
    );
    expect(lines).toEqual(["head", "body", "", "", "", "foot"]);
    expect(frameBody(40, 6)).toEqual({ columns: 40, rows: 4 });
  });

  it("clips a body taller than its share, so the footer stays put", () => {
    const tall = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const lines = plain(
      draw(
        <Frame columns={40} rows={5} header={<Text>head</Text>} footer={<Text>foot</Text>}>
          <Text>{tall}</Text>
        </Frame>,
        40,
      ),
    );
    expect(lines).toEqual(["head", "line 0", "line 1", "line 2", "foot"]);
  });

  it("draws a toast over the body's last line, two columns in, above the footer", () => {
    const lines = plain(
      draw(
        <Frame
          columns={40}
          rows={6}
          header={<Text>head</Text>}
          footer={<Text>foot</Text>}
          toast={{ text: "Saved", tone: "ok" }}
        >
          <Text>{["a", "b", "c", "╰".padEnd(39, "─")].join("\n")}</Text>
        </Frame>,
        40,
      ),
    );
    expect(lines[4]).toBe(`╰─ ✓ Saved ${"─".repeat(28)}`);
    expect(lines[5]).toBe("foot");
  });

  it("dims the body behind an overlay: gray, no colors or backgrounds, the dialog untouched", () => {
    const frame = draw(
      <Frame
        columns={40}
        rows={12}
        header={<Text>head</Text>}
        footer={<Text>foot</Text>}
        overlay={<Dialog title="Hi" width={20} />}
      >
        <Box flexDirection="column">
          <Line
            segments={[{ text: "green on purple", color: COLORS.ok, backgroundColor: "#3B2F5C" }]}
            width={40}
          />
          <Panel title="Box" focused width={40} height={3} />
        </Box>
      </Frame>,
      40,
    );
    const lines = frame.split("\n");
    const body = cells(lines[1] ?? "").slice(0, 15);
    expect(body.map((c) => c.ch).join("")).toBe("green on purple");
    expect(body.every((c) => c.fg === GRAY && c.dim && c.bg === undefined)).toBe(true);
    const border = cells(lines[2] ?? "");
    expect(border[0]).toMatchObject({ ch: "╭", fg: GRAY, dim: true });
    expect(border.slice(2, 5).every((c) => c.fg === GRAY && !c.bold)).toBe(true);
    const dialogTop = lines.findIndex((line) => stripVTControlCharacters(line).includes("╭ Hi"));
    const corner = cells(lines[dialogTop] ?? "").find(
      (c) => c.ch === "╭" && c.fg === COLORS.accent,
    );
    expect(corner).toBeDefined();
  });

  it("doesn't dim the body without an overlay", () => {
    const frame = draw(
      <Frame columns={40} rows={4} header={<Text>head</Text>} footer={<Text>foot</Text>}>
        <Line segments={[{ text: "green", color: COLORS.ok }]} width={40} />
      </Frame>,
      40,
    );
    expect(cells(frame.split("\n")[1] ?? "")[0]).toMatchObject({ fg: COLORS.ok, dim: false });
  });

  it("centers an overlay over the body", () => {
    const lines = plain(
      draw(
        <Frame
          columns={40}
          rows={12}
          header={<Text>head</Text>}
          footer={<Text>foot</Text>}
          overlay={<Dialog title="Hi" width={20} hints={[]} />}
        >
          <Text> </Text>
        </Frame>,
        40,
      ),
    );
    const top = lines.findIndex((line) => line.includes("╭"));
    const bottom = lines.findIndex((line) => line.includes("╰"));
    // 4 dialog rows (borders and a blank line each side) centered in the 10-row body.
    expect([top, bottom]).toEqual([4, 7]);
    expect(lines[top]?.indexOf("╭")).toBe(10);
  });
});
