// ABOUTME: Keeps text from consoles and APIs (names, colors, error bodies) from driving the terminal it's shown on.
// ABOUTME: Headless output shows control characters as \u escapes; a TUI line drops them, so layouts stay exact.

// C0 controls but newline and tab, DEL, C1 controls (0x9b is a one-byte CSI), and the bidi embeddings, overrides and
// isolates that can reorder what a line appears to say.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const OUTPUT_UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const LINE_SPACES = /[\t\n\r\u000b\u000c]/g;

/**
 * Text for headless output: each unsafe character becomes its visible \uXXXX escape. Inside JSON (whose own
 * escaping leaves C1 and bidi characters raw) that is the same character's JSON escape, so the data is unchanged.
 */
export function printableOutput(text: string): string {
  return text.replace(
    OUTPUT_UNSAFE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** One plain line for a terminal: tabs and line breaks become spaces, every other unsafe character is dropped. */
export function printableLine(text: string): string {
  return text.replace(LINE_SPACES, " ").replace(OUTPUT_UNSAFE, "");
}
