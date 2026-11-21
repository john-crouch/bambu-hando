// ABOUTME: The pure line editor behind every text field (editText) and the part of a long value a field shows (fieldView).
// ABOUTME: Cursors are string indices on character boundaries, so emoji and accents move and delete as one.

import type { KeyPress } from "../core/keys.js";
import { textWidth } from "./text.js";

export interface TextState {
  value: string;
  /** A string index on a character boundary: 0 before the first character, value.length after the last. */
  cursor: number;
}

/** An edit's result; submit when the keys were a burst that ended in enter (a scanner's "0015\r"). */
export interface TextEdit extends TextState {
  submit?: true;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Indices of every character boundary, 0 and value.length included. */
function boundaries(value: string): number[] {
  const out = [...segmenter.segment(value)].map((part) => part.index);
  out.push(value.length);
  return out;
}

function previous(value: string, cursor: number): number {
  return boundaries(value).findLast((index) => index < cursor) ?? 0;
}

function next(value: string, cursor: number): number {
  return boundaries(value).find((index) => index > cursor) ?? value.length;
}

/** The start of the word before the cursor: back over spaces, then over the word. */
function wordStart(value: string, cursor: number): number {
  let at = cursor;
  while (at > 0 && /\s/.test(value[at - 1] ?? "")) at--;
  while (at > 0 && !/\s/.test(value[at - 1] ?? "")) at--;
  return at;
}

/** The end of the word after the cursor: forward over spaces, then over the word. */
function wordEnd(value: string, cursor: number): number {
  let at = cursor;
  while (at < value.length && /\s/.test(value[at] ?? "")) at++;
  while (at < value.length && !/\s/.test(value[at] ?? "")) at++;
  return at;
}

function snap(state: TextState): TextState {
  const cursor = Math.max(0, Math.min(state.cursor, state.value.length));
  const onBoundary = boundaries(state.value).includes(cursor);
  return { value: state.value, cursor: onBoundary ? cursor : previous(state.value, cursor) };
}

function insert({ value, cursor }: TextState, text: string): TextState {
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}

function remove({ value }: TextState, from: number, to: number): TextState {
  return { value: value.slice(0, from) + value.slice(to), cursor: from };
}

// Control characters (C0, DEL, C1) never belong in a field.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * The field after a key, or undefined for keys that aren't editing (enter, esc, tab, ↑↓, other ctrl
 * keys), which the caller handles. Typed text, a burst included, goes in at the cursor; a burst with
 * enter in it is typed up to the enter and reported as submit.
 */
export function editText(state: TextState, key: KeyPress): TextEdit | undefined {
  const current = snap(state);
  const { value, cursor } = current;
  const word = key.meta || key.ctrl;

  switch (key.name) {
    case "left":
      return { value, cursor: word ? wordStart(value, cursor) : previous(value, cursor) };
    case "right":
      return { value, cursor: word ? wordEnd(value, cursor) : next(value, cursor) };
    case "home":
      return { value, cursor: 0 };
    case "end":
      return { value, cursor: value.length };
    case "backspace":
      if (key.meta) return remove(current, wordStart(value, cursor), cursor);
      return remove(current, previous(value, cursor), cursor);
    case "delete":
      return remove(current, cursor, next(value, cursor));
    case "space":
      return key.ctrl || key.meta ? undefined : insert(current, " ");
    case undefined:
      break;
    default:
      return undefined;
  }

  if (key.ctrl) {
    switch (key.input.toLowerCase()) {
      case "a":
        return { value, cursor: 0 };
      case "e":
        return { value, cursor: value.length };
      case "w":
        return remove(current, wordStart(value, cursor), cursor);
      case "u":
        return remove(current, 0, cursor);
      default:
        return undefined;
    }
  }
  if (key.meta || key.input === "") return undefined;

  const enter = key.input.search(/[\r\n]/);
  const typed = (enter === -1 ? key.input : key.input.slice(0, enter)).replace(CONTROL, "");
  const result = insert(current, typed);
  return enter === -1 ? result : { ...result, submit: true };
}

/** What a field of `width` columns shows: text before the cursor, the cursor's cell, text after, hidden sides. */
export interface FieldView {
  before: string;
  /** The character under the cursor, or a space after the end. */
  at: string;
  after: string;
  /** Text is hidden on that side (drawn as …). */
  left: boolean;
  right: boolean;
}

/**
 * The window of value to show in width columns with the cursor in sight: the whole value when it fits,
 * else the text just before the cursor (and after it, as room allows), one column for each … marker.
 * mask replaces every character, as a security key's field does.
 */
export function fieldView(value: string, cursor: number, width: number, mask?: string): FieldView {
  const chars = [...segmenter.segment(value)].map((part) => ({
    index: part.index,
    text: mask ?? part.segment,
  }));
  const at = Math.max(0, Math.min(cursor, value.length));
  let ci = chars.findIndex((char) => char.index >= at);
  if (ci === -1) ci = chars.length;
  const cells = chars.map((char) => char.text);
  if (ci === chars.length) cells.push(" ");
  const widths = cells.map((cell) => textWidth(cell));

  const total = widths.reduce((a, b) => a + b, 0);
  let start = 0;
  let end = cells.length;
  let marks = true;
  if (total > width) {
    // Grow a window from the cursor's cell: leftwards first (what you just typed), then rightwards.
    const used = (s: number, e: number): number =>
      widths.slice(s, e).reduce((a, b) => a + b, 0) + (s > 0 ? 1 : 0) + (e < cells.length ? 1 : 0);
    start = ci;
    end = ci + 1;
    while (start > 0 && used(start - 1, end) <= width) start--;
    while (end < cells.length && used(start, end + 1) <= width) end++;
    // Too narrow for even the cursor and its markers: the cursor alone.
    marks = used(start, end) <= width;
  }
  return {
    before: cells.slice(start, ci).join(""),
    at: cells[ci] ?? " ",
    after: cells.slice(ci + 1, end).join(""),
    left: marks && start > 0,
    right: marks && end < cells.length,
  };
}
