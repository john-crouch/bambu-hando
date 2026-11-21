// ABOUTME: Renders a whole mock screen from the design system (frame, header, list and detail panels, footer) at 80x24 and 120x36.
// ABOUTME: Asserts the frame is exactly the terminal's size, line by line, and keeps the 80x24 screen as an inline picture.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";

import {
  Bar,
  Detail,
  type DetailRow,
  Dialog,
  Footer,
  Frame,
  frameBody,
  Header,
  List,
  type ListRow,
  listPosition,
  Panel,
  panelInner,
  Swatch,
  splitWidths,
  TextField,
  textWidth,
  theme,
} from "../src/tui/ui/index.js";

const SPOOLS = [
  { id: 14, name: "Sunlu PETG 2.0 Vivid Yellow", left: 564, color: "#FFD700" },
  { id: 13, name: "OVERTURE PLA Basic White", left: 120, color: "#FFFFFF" },
  { id: 12, name: "OVERTURE PETG Basic Black", left: 871, color: "#000000" },
  { id: 11, name: "Polymaker PolyLite™ PLA Galaxy Dark Blue", left: 1000, color: "#1E2A78" },
  { id: 10, name: "eSun PLA+ Fire Engine Red", left: 37, color: "#C8102E" },
  { id: 9, name: "Elegoo Rapid PETG Translucent Green", left: 402, color: "#3CB371" },
];

function rows(): ListRow[] {
  return SPOOLS.map((spool) => ({
    key: String(spool.id),
    ticked: spool.id === 12,
    swatch: spool.color,
    cells: [
      { text: `#${spool.id}`, width: 4, dim: true },
      { text: spool.name, grow: true },
      { text: `${spool.left} g`, width: 6, align: "right" as const },
    ],
    ...(spool.left < 150 ? { tone: "warning" as const } : {}),
  }));
}

const DETAIL: DetailRow[] = [
  { label: "Material", value: "PETG · Sunlu" },
  { label: "Code", value: "P4840583", dim: true },
  { label: "", value: "" },
  { label: "Left", value: "564 g of 1000 g  56%", tone: "ok" },
  { label: "Empty", value: "236 g spool" },
  { label: "Location", value: "AMS 1 · slot 2" },
];

function MockScreen({
  columns,
  rows: height,
  dialog,
}: {
  columns: number;
  rows: number;
  dialog?: boolean;
}) {
  const body = frameBody(columns, height);
  const [listWidth = 0, detailWidth = 0] = splitWidths(body.columns, [3, 2]);
  const list = panelInner(listWidth, body.rows);
  const detail = panelInner(detailWidth, body.rows);
  const cursor = 0;
  return (
    <Frame
      columns={columns}
      rows={height}
      header={
        <Header
          columns={columns}
          active="spools"
          tabs={[
            { id: "spools", title: "Spools" },
            { id: "add", title: "Add" },
            { id: "presets", title: "Presets" },
            { id: "check", title: "Check", badge: 2 },
            { id: "settings", title: "Settings" },
          ]}
          status={{ console: "ok", consoleText: "SpoolEase 10.0.24.111", printerText: "X1C 0.6" }}
        />
      }
      footer={
        <Footer
          columns={columns}
          hints={[
            { keys: "↑↓", label: "move", primary: true },
            { keys: "space", label: "tick", primary: true },
            { keys: "/", label: "filter" },
            { keys: "s", label: "sort" },
            { keys: "l", label: "label", primary: true },
            { keys: "+", label: "more like this" },
            { keys: "?", label: "help", primary: true },
          ]}
        />
      }
      overlay={
        dialog ? (
          <Dialog
            title="More spools like #14"
            width={44}
            hints={[
              { keys: "a", label: "add 3" },
              { keys: "esc", label: "cancel" },
            ]}
          >
            <TextField value="3" cursor={1} focused width={10} />
          </Dialog>
        ) : undefined
      }
    >
      <Panel
        title="Spools"
        subtitle={`${SPOOLS.length} on the console`}
        focused
        width={listWidth}
        height={body.rows}
        footerRight={listPosition(cursor, SPOOLS.length)}
      >
        <List
          rows={rows()}
          cursor={cursor}
          height={list.height}
          width={list.width}
          marker="check"
        />
      </Panel>
      <Panel title="#14" width={detailWidth} height={body.rows}>
        <Box paddingLeft={1} flexDirection="column">
          <Swatch color="#FFD700" width={detail.width - 2} height={2} />
        </Box>
        <Detail rows={[{ label: "", value: "" }, ...DETAIL]} width={detail.width} />
        <Box paddingLeft={1} paddingTop={1}>
          <Bar fraction={0.56} width={detail.width - 2} tone="ok" />
        </Box>
      </Panel>
    </Frame>
  );
}

function screen(columns: number, height: number, dialog = false): string[] {
  const frame = renderToString(
    <ThemeProvider theme={theme}>
      <MockScreen columns={columns} rows={height} dialog={dialog} />
    </ThemeProvider>,
    { columns },
  );
  return stripVTControlCharacters(frame).split("\n");
}

describe("a whole screen", () => {
  it.each([
    [80, 24],
    [120, 36],
  ])(
    "at %ix%i is exactly the terminal: every body line full width, header and footer within it",
    (columns, height) => {
      for (const dialog of [false, true]) {
        const lines = screen(columns, height, dialog);
        expect(lines).toHaveLength(height);
        const [header = "", ...rest] = lines;
        const footer = rest.pop() ?? "";
        expect(textWidth(header)).toBeLessThanOrEqual(columns);
        expect(textWidth(footer)).toBeLessThanOrEqual(columns);
        expect(header.startsWith(" bambu-hando")).toBe(true);
        expect(footer.startsWith(" ↑↓ move")).toBe(true);
        // Both panels are bordered, so every body line runs edge to edge.
        for (const [index, line] of rest.entries()) {
          expect(textWidth(line), `body line ${index}: ${line}`).toBe(columns);
        }
        expect(rest[0]?.startsWith("╭ Spools · 6 on the console")).toBe(true);
        expect(rest.at(-1)?.startsWith("╰")).toBe(true);
        expect(rest.at(-1)?.endsWith("╯")).toBe(true);
      }
    },
  );

  it("looks like this at 80x24", () => {
    expect(`\n${screen(80, 24).join("\n")}\n`).toMatchInlineSnapshot(`
      "
       bambu-hando   Spools  Add  Presets  Check 2  Settings  ✓ SpoolEase 10.0.24.111
      ╭ Spools · 6 on the console ───────────────────╮╭ #14 ─────────────────────────╮
      │▌[ ]    #14  Sunlu PETG 2.0 Vivid Yel…  564 g ││                              │
      │ [ ]    #13  OVERTURE PLA Basic White   120 g ││                              │
      │ [✓] ▕▏ #12  OVERTURE PETG Basic Black  871 g ││                              │
      │ [ ]    #11  Polymaker PolyLite™ PLA…  1000 g ││ Material  PETG · Sunlu       │
      │ [ ]    #10  eSun PLA+ Fire Engine Red   37 g ││ Code      P4840583           │
      │ [ ]    #9   Elegoo Rapid PETG Transl…  402 g ││                              │
      │                                              ││ Left      564 g of 1000 g…   │
      │                                              ││ Empty     236 g spool        │
      │                                              ││ Location  AMS 1 · slot 2     │
      │                                              ││                              │
      │                                              ││ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱ │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      │                                              ││                              │
      ╰──────────────────────────────────────── 1/6 ─╯╰──────────────────────────────╯
       ↑↓ move  space tick  / filter  s sort  l label  + more like this  ? help
      "
    `);
  });

  it("looks like this at 120x36 with a dialog open", () => {
    expect(`\n${screen(120, 36, true).join("\n")}\n`).toMatchInlineSnapshot(`
      "
       bambu-hando   Spools  Add  Presets  Check 2  Settings                                ✓ SpoolEase 10.0.24.111 · X1C 0.6
      ╭ Spools · 6 on the console ───────────────────────────────────────────╮╭ #14 ─────────────────────────────────────────╮
      │▌[ ]    #14  Sunlu PETG 2.0 Vivid Yellow                        564 g ││                                              │
      │ [ ]    #13  OVERTURE PLA Basic White                           120 g ││                                              │
      │ [✓] ▕▏ #12  OVERTURE PETG Basic Black                          871 g ││                                              │
      │ [ ]    #11  Polymaker PolyLite™ PLA Galaxy Dark Blue          1000 g ││ Material  PETG · Sunlu                       │
      │ [ ]    #10  eSun PLA+ Fire Engine Red                           37 g ││ Code      P4840583                           │
      │ [ ]    #9   Elegoo Rapid PETG Translucent Green                402 g ││                                              │
      │                                                                      ││ Left      564 g of 1000 g  56%               │
      │                                                                      ││ Empty     236 g spool                        │
      │                                                                      ││ Location  AMS 1 · slot 2                     │
      │                                                                      ││                                              │
      │                                                                      ││ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                     ╭ More spools like #14 ────────────────────╮                                     │
      │                                     │                                          │                                     │
      │                                     │  3                                       │                                     │
      │                                     │                                          │                                     │
      │                                     │  a add 3  esc cancel                     │                                     │
      │                                     │                                          │                                     │
      │                                     ╰──────────────────────────────────────────╯                                     │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      │                                                                      ││                                              │
      ╰──────────────────────────────────────────────────────────────── 1/6 ─╯╰──────────────────────────────────────────────╯
       ↑↓ move  space tick  / filter  s sort  l label  + more like this  ? help
      "
    `);
  });
});
