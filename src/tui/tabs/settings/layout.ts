// ABOUTME: The Settings tab's geometry: the page bar, the rows panel and the detail or list panel beside it.
// ABOUTME: Pure, so the update pages its lists by the same rows the view draws.

import type { Ctx } from "../../core/types.js";
import { panelInner } from "../../ui/index.js";

export interface SettingsLayout {
  /** Both panels' height, borders included (the page bar is above them). */
  height: number;
  /** The rows panel's width and the detail panel's, borders included. */
  left: number;
  right: number;
}

export function settingsLayout(ctx: Ctx): SettingsLayout {
  const left = ctx.bodyColumns >= 110 ? 56 : Math.floor(ctx.bodyColumns * 0.52);
  return {
    height: Math.max(3, ctx.bodyRows - 1),
    left,
    right: Math.max(0, ctx.bodyColumns - left),
  };
}

/** Lines under an open list: a gap and a note (why it may be short, or still reading). */
const LIST_FOOT = 2;

/** Items an open list shows at once. */
export function listRows(ctx: Ctx): number {
  const { right, height } = settingsLayout(ctx);
  return Math.max(1, panelInner(right, height).height - LIST_FOOT);
}
