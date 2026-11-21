// ABOUTME: The Settings tab's geometry: the page bar, the rows panel and the detail or list panel beside or under it.
// ABOUTME: Pure, so the update pages its lists by the same rows the view draws.

import type { Ctx } from "../../core/types.js";
import { panelInner } from "../../ui/index.js";
import { PAGE_FIELDS, type PageId } from "./fields.js";

/** Below this many body columns the detail panel goes under the rows, so values keep the whole width. */
export const STACK_BELOW = 90;

export interface SettingsLayout {
  /** The detail panel goes under the rows instead of beside them. */
  stacked: boolean;
  /** The rows panel's width and the detail panel's, borders included. */
  left: number;
  right: number;
  /** The rows panel's height and the detail panel's, borders included (the page bar is above them). */
  rowsHeight: number;
  sideHeight: number;
}

export function settingsLayout(ctx: Ctx, page: PageId): SettingsLayout {
  const height = Math.max(3, ctx.bodyRows - 1);
  if (ctx.bodyColumns < STACK_BELOW) {
    // The rows and their borders; the detail panel takes what's left, at least a few lines.
    const rowsHeight = Math.min(PAGE_FIELDS[page].length + 2, Math.max(3, height - 5));
    return {
      stacked: true,
      left: ctx.bodyColumns,
      right: ctx.bodyColumns,
      rowsHeight,
      sideHeight: Math.max(3, height - rowsHeight),
    };
  }
  const left = ctx.bodyColumns >= 110 ? 56 : Math.floor(ctx.bodyColumns * 0.52);
  return {
    stacked: false,
    left,
    right: Math.max(0, ctx.bodyColumns - left),
    rowsHeight: height,
    sideHeight: height,
  };
}

/** Lines under an open list: a gap and a note (why it may be short, or still reading). */
const LIST_FOOT = 2;

/** Lines above an open list: its filter, while there is one. */
export const LIST_HEAD = 1;

/** Items an open list shows at once. */
export function listRows(ctx: Ctx, page: PageId, filtered = false): number {
  const { right, sideHeight } = settingsLayout(ctx, page);
  return Math.max(1, panelInner(right, sideHeight).height - LIST_FOOT - (filtered ? LIST_HEAD : 0));
}
