// ABOUTME: A one-line text input: the value scrolled so the cursor is in sight, the cursor a reversed cell, … for hidden text.
// ABOUTME: Render-only; the tab edits the value with editText and passes value and cursor back.

import { Line } from "./Line.js";
import { type Segment, truncate } from "./text.js";
import { fieldView } from "./textField.js";
import { COLORS } from "./theme.js";

export { editText, fieldView, type TextEdit, type TextState } from "./textField.js";

export interface TextFieldProps {
  value: string;
  cursor: number;
  focused: boolean;
  placeholder?: string;
  /** Show every character as this (true: •), for a security key. */
  mask?: boolean | string;
  width: number;
}

export const MASK = "•";

export function textFieldSegments({
  value,
  cursor,
  focused,
  placeholder,
  mask,
  width,
}: TextFieldProps): Segment[] {
  if (width <= 0) return [];
  const maskChar = mask === true ? MASK : mask || undefined;
  if (value === "") {
    const hint = placeholder ? truncate(placeholder, focused ? width - 1 : width) : "";
    return [
      ...(focused ? [{ text: " ", inverse: true }] : []),
      ...(hint ? [{ text: hint, color: COLORS.muted }] : []),
    ];
  }
  const view = fieldView(value, cursor, width, maskChar);
  const ellipsis = { text: "…", color: COLORS.muted };
  return [
    ...(view.left ? [ellipsis] : []),
    { text: view.before },
    focused ? { text: view.at, inverse: true } : { text: view.at },
    { text: view.after },
    ...(view.right ? [ellipsis] : []),
  ];
}

export function TextField(props: TextFieldProps) {
  return <Line segments={textFieldSegments(props)} width={props.width} />;
}
