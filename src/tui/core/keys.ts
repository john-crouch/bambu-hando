// ABOUTME: One key event shape for the whole TUI, made from Ink's (input, key) pair, plus the helpers updates use.
// ABOUTME: Updates match on KeyPress only, so they're tested without Ink; bursts (a scanner's "0015\r") stay whole in input.

import type { Key } from "ink";

export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageUp"
  | "pageDown"
  | "home"
  | "end"
  | "enter"
  | "esc"
  | "tab"
  | "backspace"
  | "delete"
  | "space";

export interface KeyPress {
  /** The named key, when it's one; undefined for printable text. */
  name?: KeyName;
  /**
   * The text typed: one character, or several when they arrived together (a paste or a barcode scanner,
   * which can end in "\r"). Empty for named keys other than space.
   */
  input: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

/** Ink's key event as a KeyPress. */
export function keyPress(input: string, key: Key): KeyPress {
  const mods = { ctrl: key.ctrl, shift: key.shift, meta: key.meta };
  const named = (name: KeyName, text = ""): KeyPress => ({ name, input: text, ...mods });
  if (key.upArrow) return named("up");
  if (key.downArrow) return named("down");
  if (key.leftArrow) return named("left");
  if (key.rightArrow) return named("right");
  if (key.pageUp) return named("pageUp");
  if (key.pageDown) return named("pageDown");
  if (key.home) return named("home");
  if (key.end) return named("end");
  if (key.tab) return named("tab");
  if (key.escape) return named("esc");
  if (key.backspace) return named("backspace");
  if (key.delete) return named("delete");
  // A burst ending in enter stays text, so a scan arrives whole; a lone enter is the key.
  if (key.return && (input === "\r" || input === "\n" || input === "")) return named("enter");
  if (input === " " && !key.ctrl && !key.meta) return named("space", " ");
  return { input, ...mods };
}

/** Test and update helper: a KeyPress for a named key or for typed text. */
export function press(
  what: KeyName | string,
  mods: Partial<Pick<KeyPress, "ctrl" | "shift" | "meta">> = {},
): KeyPress {
  const base = { ctrl: false, shift: false, meta: false, ...mods };
  return KEY_NAMES.has(what as KeyName)
    ? { name: what as KeyName, input: what === "space" ? " " : "", ...base }
    : { input: what, ...base };
}

const KEY_NAMES = new Set<KeyName>([
  "up",
  "down",
  "left",
  "right",
  "pageUp",
  "pageDown",
  "home",
  "end",
  "enter",
  "esc",
  "tab",
  "backspace",
  "delete",
  "space",
]);

/** Printable text without ctrl or meta: what a text field or type-ahead takes. */
export function typed(key: KeyPress): string {
  if (key.ctrl || key.meta) return "";
  if (key.name === "space") return " ";
  return key.name ? "" : key.input;
}

/** A single typed character (letter, digit, punctuation), lowercased: what type-ahead jumps on. */
export function letter(key: KeyPress): string {
  const text = typed(key);
  return text.length === 1 && text !== " " ? text.toLowerCase() : "";
}

/** ctrl plus a letter, e.g. ctrl("k"). */
export function isCtrl(key: KeyPress, char: string): boolean {
  return key.ctrl && key.input.toLowerCase() === char;
}

/** Typed text as a key: never read as a key name ("end" typed is text), a lone space is space. */
function textKey(text: string): KeyPress {
  return text === " " ? press("space") : { input: text, ctrl: false, shift: false, meta: false };
}

/** A C0 control character, or DEL. */
function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/** The key one control character stands for, when it arrives inside a burst. */
function controlKey(char: string): KeyPress {
  if (char === "\t") return press("tab");
  if (char === "\r" || char === "\n") return press("enter");
  if (char === "\u007F" || char === "\b") return press("backspace");
  // ctrl+a … ctrl+z arrive as 0x01 … 0x1a.
  return press(String.fromCharCode(char.charCodeAt(0) + 0x60), { ctrl: true });
}

/**
 * Ink's input as the keys it holds. Ink splits only at escape sequences and backspaces, so on a busy
 * machine two keys pressed quickly can arrive as one input ("\t?": tab, then ?), which matches no key.
 * A burst holding a control character is split into its keys, and the text between them; a run of text
 * ending in enter stays whole (a barcode scanner's "00150603Z\r" is one scan).
 */
export function keyPresses(input: string, key: Key): KeyPress[] {
  const chars = [...input];
  const controls = chars.filter(isControl);
  const scan = controls.length === 1 && /[\r\n]$/.test(input);
  if (chars.length <= 1 || controls.length === 0 || scan) return [keyPress(input, key)];
  const keys: KeyPress[] = [];
  let text = "";
  for (const char of chars) {
    if (!isControl(char)) {
      text += char;
      continue;
    }
    if ((char === "\r" || char === "\n") && text) {
      keys.push(textKey(text + char));
      text = "";
      continue;
    }
    if (text) keys.push(textKey(text));
    text = "";
    keys.push(controlKey(char));
  }
  if (text) keys.push(textKey(text));
  return keys;
}
