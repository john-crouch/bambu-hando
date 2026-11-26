// ABOUTME: Values for people, one spelling across every tab: temperatures, ranges, grams, printers, counts.
// ABOUTME: Pure string helpers; tabs use these instead of formatting the same thing their own way.

import { homedir } from "node:os";

import { ELLIPSIS, textWidth, truncate } from "./text.js";

/** "220°C" (no space, as the design says). */
export function formatTemp(celsius: number): string {
  return `${celsius}°C`;
}

/** "220°C" when both ends match, else "190–230°C" (en dash). A missing end is left out. */
export function formatRange(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  const lo = typeof low === "number" && Number.isFinite(low) ? low : null;
  const hi = typeof high === "number" && Number.isFinite(high) ? high : null;
  if (lo === null && hi === null) return "";
  if (lo === null) return formatTemp(hi as number);
  if (hi === null || lo === hi) return formatTemp(lo);
  return `${lo}–${hi}°C`;
}

/** "564 g"; whole grams. */
export function formatGrams(grams: number): string {
  return `${Math.round(grams)} g`;
}

/** BambuStudio's printer name, short: "Bambu Lab X1 Carbon 0.6 nozzle" → "X1C 0.6". */
export function shortPrinter(name: string): string {
  return name
    .trim()
    .replace(/^Bambu Lab /, "")
    .replace(/^X1 Carbon\b/, "X1C")
    .replace(/ nozzle$/, "");
}

/** "1 spool", "3 spools"; plural defaults to noun + "s". */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** text cut in its middle to at most width columns, so its start and its end both show: "Polyma….json". */
function cutMiddle(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  if (width <= 1) return truncate(text, width);
  const chars = [...text];
  let head = Math.ceil((width - 1) / 2);
  let tail = width - 1 - head;
  // Wide characters can make the halves too wide: give back from the longer one until it fits.
  const build = () =>
    `${chars.slice(0, head).join("").trimEnd()}${ELLIPSIS}${tail > 0 ? chars.slice(-tail).join("").trimStart() : ""}`;
  let out = build();
  while (textWidth(out) > width && head + tail > 0) {
    if (head >= tail) head--;
    else tail--;
    out = build();
  }
  return out;
}

/**
 * A path for people within width columns: HOME as ~, then folders cut out of the middle
 * ("~/…/base/Polymaker PETG @X1C 0.4.json"), keeping as many folders before the file as fit; the file
 * name itself is cut in its middle only when even "~/…/name" is too wide.
 */
export function fitPath(path: string, width: number, home: string = homedir()): string {
  if (width <= 0) return "";
  const shown =
    home && home !== "/" && (path === home || path.startsWith(`${home}/`))
      ? `~${path.slice(home.length)}`
      : path;
  if (textWidth(shown) <= width) return shown;
  const parts = shown.split("/");
  const base = parts.pop() ?? "";
  // "~", "" (the root of an absolute path) or a relative path's first folder.
  const first = parts.shift();
  if (first === undefined) return cutMiddle(base, width);
  let tail = base;
  for (let at = parts.length - 1; at >= 0; at--) {
    const longer = `${parts[at]}/${tail}`;
    if (textWidth(`${first}/${ELLIPSIS}/${longer}`) > width) break;
    tail = longer;
  }
  const lead = `${first}/${ELLIPSIS}/`;
  if (tail !== base || textWidth(lead + base) <= width) return lead + tail;
  // The name is what tells files apart: below a few columns of it, show only the name.
  return width - textWidth(lead) >= 8
    ? lead + cutMiddle(base, width - textWidth(lead))
    : cutMiddle(base, width);
}
