// ABOUTME: The shell's own messages (on top of the contract's AppMsg) and the shape of the overlays it owns.
// ABOUTME: Kept apart from shell.ts so the help, palette and confirm overlays can send them without an import cycle.

import type { ReactElement } from "react";

import type { Cmd } from "../core/program.js";
import type { AppMsg, Ctx, Hint, Resource, ResourceId, TabId, TabMsg } from "../core/types.js";

export type ShellMsg =
  | AppMsg
  /** The first frame is on screen: start the background loads. */
  | { type: "shell/mounted" }
  /** A load the shell started finished; gen drops results a newer load replaced. */
  | { type: "shell/loaded"; resource: ResourceId; gen: number; result: Resource<unknown> }
  | { type: "shell/toastExpired"; id: number }
  | { type: "shell/help" };

/** An overlay the shell itself owns: like the contract's OverlayModule, but its commands may send shell messages. */
export interface ShellOverlay<M, Req> {
  init(request: Req, ctx: Ctx): [M, Cmd<ShellMsg>[]];
  update(model: M, msg: AppMsg | TabMsg, ctx: Ctx): [M, Cmd<ShellMsg>[]];
  View(props: { model: M; ctx: Ctx }): ReactElement;
  hints(model: M, ctx: Ctx): Hint[];
  /** What the overlay is writing right now, else null: the shell won't quit meanwhile. */
  busy?(model: M): string | null;
}

/** A command palette entry; tab, when set, is shown first, so a tab's command runs where its result shows. */
export interface PaletteItem {
  title: string;
  detail?: string;
  msg: ShellMsg;
  tab?: TabId;
}

/** A command that closes the open overlay, then sends msgs. */
export function closeThen(...msgs: ShellMsg[]): Cmd<ShellMsg> {
  return (dispatch) => {
    dispatch({ type: "app/closeOverlay" });
    for (const msg of msgs) dispatch(msg);
  };
}
