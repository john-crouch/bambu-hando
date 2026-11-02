// ABOUTME: TUI start menu: add spools from SpoolmanDB, import the --source file, settings, or quit.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { basename } from "node:path";

import { Box, type Key, Text } from "ink";

import { SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import { listMove, typeAhead, typedLetter } from "./menu.js";

const LABEL_WIDTH = 46;

export type HomeId = "spoolmandb" | "import" | "settings" | "quit";

export interface HomeItem {
  id: HomeId;
  label: string;
  detail: string;
}

export type HomeAction = { type: "move"; cursor: number } | { type: "choose"; id: HomeId } | { type: "none" };

/** SpoolmanDB, settings and quit, plus an import item when the source is a file or URL. */
export function homeItems(source: string): HomeItem[] {
  const file = source.trim();
  return [
    { id: "spoolmandb", label: "Add spools from SpoolmanDB", detail: "browse brands, materials and colors" },
    ...(file && file !== SPOOLMANDB_SOURCE ? [{ id: "import" as const, label: `Import ${basename(file)}`, detail: "sync the profiles it lists" }] : []),
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
}

export function HomeMenu({ items, cursor, context }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold>bambu-hando: sync filament profiles to BambuStudio and SpoolEase</Text>
      <Box flexDirection="column" marginY={1}>
        {items.map((item, index) => {
          const active = index === cursor;
          return (
            <Box key={item.id}>
              <Box width={2}>
                <Text>{active ? "›" : ""}</Text>
              </Box>
              <Box width={LABEL_WIDTH} paddingRight={1}>
                <Text wrap="truncate-end" color={active ? "cyan" : undefined}>
                  {item.label}
                </Text>
              </Box>
              <Text dimColor>{item.detail}</Text>
            </Box>
          );
        })}
      </Box>
      {context.map((line) => (
        <Text key={line} dimColor>
          {line}
        </Text>
      ))}
      <Text dimColor>↑/↓ move · letter jumps · enter choose · ctrl+c quit</Text>
    </Box>
  );
}
