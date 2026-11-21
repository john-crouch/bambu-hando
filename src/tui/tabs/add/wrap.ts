// ABOUTME: Word wrap for the Add tab's prose (notes, explanations): lines broken at spaces to fit a width.
// ABOUTME: Widths as the terminal draws them; a word longer than a line is cut with …, as truncate does.

import { textWidth, truncate } from "../../ui/text.js";

/** The text in lines at most `width` wide; with `max`, at most that many, the last cut with … when more is left. */
export function wrapText(text: string, width: number, max = Number.POSITIVE_INFINITY): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (textWidth(joined) <= width) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = textWidth(word) <= width ? word : truncate(word, width);
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept.length - 1;
  kept[last] = truncate(`${kept[last]} ${lines[max]}`, width);
  if (!kept[last]?.endsWith("…")) kept[last] = truncate(`${kept[last]}…`, width);
  return kept;
}
