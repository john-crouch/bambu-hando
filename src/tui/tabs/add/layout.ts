// ABOUTME: The Add tab's sizes: page bar and status line around the page, list and detail side by side or stacked.
// ABOUTME: Pure arithmetic from the body's size, shared by the views and by update's paging.

import { splitWidths } from "../../ui/Panel.js";

/** The page bar on top and the status line at the bottom. */
export const ADD_CHROME = 2;

/** From this width the detail panel sits beside the list; below it, under the list. */
export const SIDE_BY_SIDE = 90;

export interface Box {
  width: number;
  height: number;
}

export interface Split {
  side: boolean;
  list: Box;
  detail: Box;
}

/** The page's area inside the body. */
export function pageArea(columns: number, rows: number): Box {
  return { width: Math.max(0, columns), height: Math.max(0, rows - ADD_CHROME) };
}

/** A list panel and its detail panel in the page area: 3:2 side by side, else the detail takes the bottom. */
export function splitPage(area: Box): Split {
  if (area.width >= SIDE_BY_SIDE) {
    const [list = 0, detail = 0] = splitWidths(area.width, [3, 2]);
    return {
      side: true,
      list: { width: list, height: area.height },
      detail: { width: detail, height: area.height },
    };
  }
  const detail = Math.min(10, Math.max(5, Math.floor(area.height * 0.4)));
  return {
    side: false,
    list: { width: area.width, height: Math.max(3, area.height - detail) },
    detail: { width: area.width, height: Math.min(detail, Math.max(0, area.height - 3)) },
  };
}
