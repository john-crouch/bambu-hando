// ABOUTME: TUI start menu: add spools from SpoolmanDB, import the --source file, more spools, labels, sync check, settings, quit.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { basename } from "node:path";

import { Box, type Key, Text } from "ink";

import { SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import { listMove, typeAhead, typedLetter } from "./menu.js";

const LABEL_WIDTH = 46;

export type HomeId = "spoolmandb" | "import" | "more" | "barcode" | "labels" | "spools" | "check" | "settings" | "quit";

export interface HomeItem {
  id: HomeId;
  label: string;
  detail: string;
}

export type HomeAction = { type: "move"; cursor: number } | { type: "choose"; id: HomeId } | { type: "none" };

/** SpoolmanDB, settings and quit, plus import for a file or URL source, and more spools, labels and the sync check when SpoolEase is set up. */
export function homeItems(source: string, spoolease: boolean): HomeItem[] {
  const file = source.trim();
  return [
    { id: "spoolmandb", label: "Add spools from SpoolmanDB", detail: "browse brands, materials and colors" },
    ...(file && file !== SPOOLMANDB_SOURCE ? [{ id: "import" as const, label: `Import ${basename(file)}`, detail: "sync the profiles it lists" }] : []),
    ...(spoolease ? [{ id: "more" as const, label: "More spools of a filament you have", detail: "copy a spool already on your console" }] : []),
    ...(spoolease ? [{ id: "barcode" as const, label: "Barcode: more spools of what you scan", detail: "learns each barcode once" }] : []),
    ...(spoolease ? [{ id: "labels" as const, label: "Print labels for existing spools", detail: "pick spools on your SpoolEase console" }] : []),
    ...(spoolease ? [{ id: "spools" as const, label: "Your spools on the console", detail: "what's left on each and where it is" }] : []),
    ...(spoolease ? [{ id: "check" as const, label: "Check sync", detail: "compare presets, custom filaments and spools; changes nothing" }] : []),
    { id: "settings", label: "Settings", detail: "BambuStudio folder and printers, SpoolEase" },
    { id: "quit", label: "Quit", detail: "" },
  ];
}

/** A source given on the command line is what the user came for, so the menu starts on it. */
export function initialHomeCursor(items: HomeItem[]): number {
  return Math.max(0, items.findIndex((item) => item.id === "import"));
}

export function homeInput(cursor: number, input: string, key: Key, items: HomeItem[]): HomeAction {
  if (key.return) {
    const item = items[cursor];
    return item ? { type: "choose", id: item.id } : { type: "none" };
  }
  const moved = listMove(cursor, key, items.length, items.length);
  if (moved !== null) return { type: "move", cursor: moved };
  const letter = typedLetter(input, key);
  if (letter) return { type: "move", cursor: typeAhead(items.map((i) => i.label), cursor, letter) };
  return { type: "none" };
}

interface Props {
  items: HomeItem[];
  cursor: number;
  /** One line per setting the next run uses: preset folder and printers, SpoolEase. */
  context: string[];
  /** What the last labels made from the menu did. */
  outcome: { ok: boolean; lines: string[] } | null;
}

export function HomeMenu({ items, cursor, context, outcome }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold>bambu-hando: sync filament profiles to BambuStudio and SpoolEase</Text>
      <Box flexDirection="column" marginY={1}>
        {items.map((item, index) => {
          const active = index === cursor;
          return (
            <Box key={item.id}>
              {/* Fixed boxes keep their width: Ink measures a detail cut with "…" a column too wide and would take it from them. */}
              <Box width={2} flexShrink={0}>
                <Text>{active ? "›" : ""}</Text>
              </Box>
              <Box width={LABEL_WIDTH} flexShrink={0} paddingRight={1}>
                <Text wrap="truncate-end" color={active ? "cyan" : undefined}>
                  {item.label}
                </Text>
              </Box>
              <Text dimColor wrap="truncate-end">
                {item.detail}
              </Text>
            </Box>
          );
        })}
      </Box>
      {context.map((line) => (
        <Text key={line} dimColor>
          {line}
        </Text>
      ))}
      {outcome?.lines.map((line) => (
        <Text key={line} color={outcome.ok ? "green" : "red"}>
          {outcome.ok ? "✓" : "✗"} {line}
        </Text>
      ))}
      <Text dimColor>↑/↓ move · enter choose · ? help · ctrl+c quit</Text>
    </Box>
  );
}
