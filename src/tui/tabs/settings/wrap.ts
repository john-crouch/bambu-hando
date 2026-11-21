// ABOUTME: Word wrap for explanation text in the Settings and Check panels, measured as Ink measures text.
// ABOUTME: Pure, so a view and the update that sizes its scrolling list agree on how many lines a text takes.

import { textWidth, truncate } from "../../ui/index.js";

/** The text in lines of at most width columns, broken at spaces; a word longer than a line is cut with …. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = textWidth(word) <= width ? word : truncate(word, width);
  }
  if (line) lines.push(line);
  return lines;
}
