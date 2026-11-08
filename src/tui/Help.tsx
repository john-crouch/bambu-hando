// ABOUTME: TUI help page, opened with ? on any screen: what the screen is for and every key it takes.
// ABOUTME: Pages are plain data so the hint lines can stay short and the full list lives here.

import { Box, Text } from "ink";

export const HELP_TOPICS = ["home", "form", "choose", "browse", "pick", "color", "weights", "plan", "done", "copies", "labels", "check", "ids", "spools", "scan", "error"] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export interface HelpPage {
  title: string;
  about: string;
  /** [keys, what they do] */
  keys: Array<[string, string]>;
}

const MOVE: [string, string] = ["↑/↓", "move"];
const PAGE: [string, string] = ["pgup/pgdn", "move a screenful"];
const LETTERS: [string, string] = ["letters", "jump to the next item starting with what you type"];
const QUIT: [string, string] = ["ctrl+c", "quit from anywhere"];

export function helpPage(topic: HelpTopic, multi = false): HelpPage {
  switch (topic) {
    case "home":
      return {
        title: "the menu",
        about: "Where every task starts, and where each one comes back to say what it did.",
        keys: [MOVE, LETTERS, ["enter", "open the item"], QUIT],
      };
    case "form":
      return {
        title: "settings",
        about: "Where presets go and how to reach SpoolEase. In a text field, ? is typed.",
        keys: [["↑/↓ or tab", "move"], ["enter or space", "toggle, or open the list for a folder or printers"], ["typing", "edits a text field"], ["esc", "back to the menu"], QUIT],
      };
    case "choose":
      return {
        title: multi ? "a checklist" : "a list",
        about: multi ? "Tick as many as you need, then enter." : "Pick one; the current choice is marked (*).",
        keys: [MOVE, PAGE, LETTERS, ...(multi ? [["space", "tick or untick"] as [string, string], ["enter", "done"] as [string, string]] : [["enter", "choose"] as [string, string]]), ["esc", "cancel, changing nothing"], QUIT],
      };
    case "browse":
      return {
        title: "SpoolmanDB",
        about: "Open a brand, then a material, then select colors; selections are kept.",
        keys: [
          MOVE,
          PAGE,
          LETTERS,
          ["enter", "open a brand or material; on colors, go on with the selection"],
          ["space", "select a color"],
          ["ctrl+a", "select every color in the list, or none"],
          ["Other color…", "the last row: a color SpoolmanDB doesn't list"],
          ["esc", "up a level, then back to the menu"],
          QUIT,
        ],
      };
    case "pick":
      return {
        title: "search",
        about: "Every word typed must be in the name; selections are kept as you search.",
        keys: [["typing", "search"], ["backspace", "delete a letter"], MOVE, PAGE, ["tab", "select or unselect"], ["ctrl+a", "select every match, or none"], ["enter", "continue with the selection"], ["esc", "back to browsing"], QUIT],
      };
    case "color":
      return {
        title: "another color",
        about: "A color SpoolmanDB doesn't list, with the settings of a listed one.",
        keys: [MOVE, ["enter", "choose the listed color, or go to the next row"], ["typing", "edits the name and hex color (? types into the name)"], ["esc", "back to the colors"], QUIT],
      };
    case "weights":
      return {
        title: "empty spool weight",
        about: "What the empty spool weighs, so SpoolEase knows what's left; once per brand.",
        keys: [MOVE, ["enter", "choose, and go to the next brand"], ["esc", "the brand before, or back"], QUIT],
      };
    case "plan":
      return {
        title: "the plan",
        about: "What a run would write, and where; nothing is written until [a].",
        keys: [["[a]", "write the presets and SpoolEase filaments and spools"], ["[b]", "back to the filaments or the menu"], ["[q]", "quit without writing"], QUIT],
      };
    case "done":
      return {
        title: "the run",
        about: "What the run wrote; failures say why.",
        keys: [["[l]", "labels for the spools it created"], ["[m]", "back to the menu"], ["[q]", "quit"], QUIT],
      };
    case "copies":
      return {
        title: "more spools",
        about: "New spools copied from your newest one of this filament; no presets change.",
        keys: [["[a]", "add them"], ["[b]", "back to how many"], ["[l]", "labels for the new spools"], ["[m]", "back to the menu"], ["[q]", "quit"], QUIT],
      };
    case "labels":
      return {
        title: "labels",
        about: "Fields to print, label size, printer and PDF; the choices are remembered.",
        keys: [MOVE, ["space or enter", "tick a field, or open the size and printer lists"], ["typing", "edits the size or the PDF path (? types into the path)"], ["enter on Make labels", "print and/or write the PDF"], ["esc", "back"], QUIT],
      };
    case "check":
      return {
        title: "the sync check",
        about: "Where BambuStudio and SpoolEase disagree, problems first; it changes nothing.",
        keys: [["↑/↓", "scroll"], PAGE, ["[f]", "give presets without a filament ID one"], ["[r]", "check again"], ["[b] or esc", "back to the menu"], ["[q]", "quit"], QUIT],
      };
    case "spools":
      return {
        title: "your spools",
        about: "Left is SpoolEase's figure: last weight, less core and grams printed since.",
        keys: [
          ["typing", "filter: every word in the name, location, code or #id"],
          ["backspace", "delete a letter"],
          MOVE,
          PAGE,
          ["tab", "sort: newest, by name, least left, by location"],
          ["enter", "a label for the spool, or more of its filament"],
          ["esc", "clear the filter, then back to the menu"],
          QUIT,
        ],
      };
    case "scan":
      return {
        title: "barcode scan",
        about: "A scanner types like a keyboard. Each barcode is asked about once, then known.",
        keys: [["scan or type", "the barcode (UPC, EAN, a maker's code)"], ["enter", "look it up"], ["backspace", "delete a character"], ["esc", "back to the menu"], QUIT],
      };
    case "ids":
      return {
        title: "filament IDs",
        about: "Presets without a filament ID get the one BambuStudio would give them.",
        keys: [["[a]", "write the IDs into the presets"], ["[b]", "back to the check, which looks again"], ["[m]", "back to the menu, once written"], ["[q]", "quit"], QUIT],
      };
    case "error":
      return {
        title: "an error",
        about: "Nothing after the error was written.",
        keys: [["[b]", "back to settings"], ["[q]", "quit"], QUIT],
      };
  }
}

export function Help({ topic, multi = false }: { topic: HelpTopic; multi?: boolean }) {
  const page = helpPage(topic, multi);
  // Indent, the page's longest keys, and a gap.
  const keysWidth = 2 + Math.max(...page.keys.map(([keys]) => keys.length)) + 2;
  return (
    <Box flexDirection="column">
      <Text bold>Help: {page.title}</Text>
      <Text dimColor>{page.about}</Text>
      <Box flexDirection="column" marginY={1}>
        {page.keys.map(([keys, what]) => (
          <Box key={keys}>
            <Box width={keysWidth} flexShrink={0} paddingLeft={2} paddingRight={1}>
              <Text color="cyan" wrap="truncate-end">
                {keys}
              </Text>
            </Box>
            <Text wrap="truncate-end">{what}</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>any key goes back</Text>
    </Box>
  );
}
