// ABOUTME: The shell's tab modules and the labels overlay, in TAB_ORDER: what the shell routes messages to.
// ABOUTME: Holds placeholder modules (each shows its title in an empty state) until the real tabs are swapped in.

import { createElement } from "react";

import type { LabelsRequest, OverlayModule, TabId, TabModule } from "../core/types.js";
import { Dialog, Empty } from "./stub-ui.js";

/** Any tab module: the shell keeps each tab's model opaque. */
// biome-ignore lint/suspicious/noExplicitAny: each tab has its own model type, opaque to the shell.
export type AnyTab = TabModule<any>;
// biome-ignore lint/suspicious/noExplicitAny: the labels overlay's model is its own business.
export type AnyLabels = OverlayModule<any, LabelsRequest>;

function placeholder(id: TabId, title: string): TabModule<null> {
  return {
    id,
    title,
    init: () => [null, []],
    update: (model) => [model, []],
    View: () => createElement(Empty, { title, lines: ["Coming soon"] }),
    hints: () => [],
    capturesText: () => false,
  };
}

export const TABS: Record<TabId, AnyTab> = {
  spools: placeholder("spools", "Spools"),
  add: placeholder("add", "Add"),
  presets: placeholder("presets", "Presets"),
  check: placeholder("check", "Check"),
  settings: placeholder("settings", "Settings"),
};

export const LABELS: OverlayModule<LabelsRequest, LabelsRequest> = {
  id: "labels",
  init: (request) => [request, []],
  update: (model, msg) =>
    msg.type === "key" ? [model, [(dispatch) => dispatch({ type: "app/closeOverlay" })]] : [model, []],
  View: ({ model }) =>
    createElement(
      Dialog,
      { title: "Labels", hints: [{ keys: "any key", label: "close" }] },
      createElement(Empty, {
        title: `${model.spoolIds.length} spools`,
        lines: ["Coming soon"],
      }),
    ),
  hints: () => [{ keys: "any key", label: "close" }],
};
