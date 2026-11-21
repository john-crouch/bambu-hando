// ABOUTME: The confirm overlay: names every target of a write, then a applies it and esc cancels.
// ABOUTME: Tabs open it with app/confirm; the write itself is the request's onApply message.

import { Box, Text } from "ink";
import stringWidth from "string-width";

import type { ConfirmRequest, Ctx, Hint } from "../core/types.js";
import { closeThen, type ShellOverlay } from "./messages.js";
import { Dialog } from "./stub-ui.js";

export interface ConfirmModel {
  request: ConfirmRequest;
}

function confirmHints(model: ConfirmModel): Hint[] {
  return [
    { keys: "a", label: model.request.applyLabel ?? "apply", primary: true },
    { keys: "esc", label: "cancel", primary: true },
  ];
}

/** Wide enough for the longest line, within the terminal. */
export function confirmWidth(request: ConfirmRequest, columns: number): number {
  const longest = Math.max(
    stringWidth(request.title),
    ...request.lines.map((line) => stringWidth(line)),
  );
  return Math.max(30, Math.min(longest + 4, 80, columns - 4));
}

function ConfirmView({ model, ctx }: { model: ConfirmModel; ctx: Ctx }) {
  const { request } = model;
  return (
    <Dialog
      title={request.title}
      width={confirmWidth(request, ctx.columns)}
      hints={confirmHints(model)}
    >
      <Box flexDirection="column">
        {request.lines.map((line, index) => (
          // Lines may repeat (two blank ones), so the index keeps keys unique.
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
          <Text key={index} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    </Dialog>
  );
}

export const CONFIRM: ShellOverlay<ConfirmModel, ConfirmRequest> = {
  init: (request) => [{ request }, []],
  update(model, msg) {
    if (msg.type !== "key") return [model, []];
    const key = msg.key as { name?: string; input: string; ctrl: boolean; meta: boolean };
    if (key.name === "esc") return [model, [closeThen()]];
    if (!key.name && !key.ctrl && !key.meta && key.input.toLowerCase() === "a")
      return [model, [closeThen(model.request.onApply)]];
    return [model, []];
  },
  View: ConfirmView,
  hints: confirmHints,
};
