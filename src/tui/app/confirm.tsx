// ABOUTME: The confirm overlay: names every target of a write, then a applies it and esc cancels.
// ABOUTME: Tabs open it with app/confirm; the write itself is the request's onApply message.

import { Box } from "ink";

import type { ConfirmRequest, Ctx, Hint } from "../core/types.js";
import { Dialog, dialogInner, dialogWidth, Line, textWidth } from "../ui/index.js";
import { closeThen, type ShellMsg, type ShellOverlay } from "./messages.js";

/** The shell's own questions also take other apply keys (quit with q as well as a) and name what esc does. */
export interface ShellConfirmRequest extends Omit<ConfirmRequest, "onApply"> {
  /** Sent when the user applies: any shell message, so the shell can ask its own questions. */
  onApply: ShellMsg;
  /** Keys that apply, besides a. */
  applyKeys?: string[];
  cancelLabel?: string;
}

export interface ConfirmModel {
  request: ShellConfirmRequest;
}

function applyKeys(request: ShellConfirmRequest): string[] {
  return [...(request.applyKeys ?? []), "a"];
}

function confirmHints(model: ConfirmModel): Hint[] {
  return [
    {
      keys: applyKeys(model.request).join("/"),
      label: model.request.applyLabel ?? "apply",
      primary: true,
    },
    { keys: "esc", label: model.request.cancelLabel ?? "cancel", primary: true },
  ];
}

/** Wide enough for the longest line, within the terminal. */
export function confirmWidth(request: ShellConfirmRequest, columns: number): number {
  const longest = Math.max(
    textWidth(request.title),
    ...request.lines.map((line) => textWidth(line)),
  );
  // The dialog's border and padding take 3 columns a side.
  return dialogWidth(columns, Math.min(Math.max(30, longest + 6), 80));
}

function ConfirmView({ model, ctx }: { model: ConfirmModel; ctx: Ctx }) {
  const { request } = model;
  const width = confirmWidth(request, ctx.columns);
  return (
    <Dialog title={request.title} width={width}>
      <Box flexDirection="column">
        {request.lines.map((line, index) => (
          // Lines may repeat (two blank ones), so the index keeps keys unique.
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
          <Line key={index} segments={[{ text: line }]} width={dialogInner(width)} />
        ))}
      </Box>
    </Dialog>
  );
}

export const CONFIRM: ShellOverlay<ConfirmModel, ShellConfirmRequest> = {
  init: (request) => [{ request }, []],
  update(model, msg) {
    if (msg.type !== "key") return [model, []];
    const key = msg.key as { name?: string; input: string; ctrl: boolean; meta: boolean };
    if (key.name === "esc") return [model, [closeThen()]];
    if (
      !key.name &&
      !key.ctrl &&
      !key.meta &&
      applyKeys(model.request).includes(key.input.toLowerCase())
    )
      return [model, [closeThen(model.request.onApply)]];
    return [model, []];
  },
  View: ConfirmView,
  hints: confirmHints,
};
