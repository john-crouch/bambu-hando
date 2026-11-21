// ABOUTME: Values for people, one spelling across every tab: temperatures, ranges, grams, printers, counts.
// ABOUTME: Pure string helpers; tabs use these instead of formatting the same thing their own way.

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
