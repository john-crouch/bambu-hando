// ABOUTME: The shell's tab modules and the labels overlay, in TAB_ORDER: what the shell routes messages to.
// ABOUTME: Holds placeholder modules (each shows its title in an empty state) until the real tabs are swapped in.

import { createElement } from "react";

import type { Ctx, LabelsRequest, OverlayModule, TabId, TabModule } from "../core/types.js";
import { labelsOverlay } from "../overlays/labels/index.js";
import { checkTab } from "../tabs/check/index.js";
import { presetsTab } from "../tabs/presets/index.js";
import { settingsTab } from "../tabs/settings/index.js";
import { spoolsTab } from "../tabs/spools/index.js";
import { Empty } from "../ui/index.js";

/** Any tab module: the shell keeps each tab's model opaque. */
// biome-ignore lint/suspicious/noExplicitAny: each tab has its own model type, opaque to the shell.
export type AnyTab = TabModule<any>;
/** The labels overlay, whatever its model. */
// biome-ignore lint/suspicious/noExplicitAny: the labels overlay's model is its own business.
export type AnyLabels = OverlayModule<any, LabelsRequest>;

interface PlaceholderModel {
  title: string;
}

function PlaceholderView({ model, ctx }: { model: PlaceholderModel; ctx: Ctx }) {
  return createElement(Empty, {
    title: model.title,
    lines: ["Coming soon"],
    width: ctx.bodyColumns,
    height: ctx.bodyRows,
  });
}

/** A tab that only shows its title: the shell's own tests use these, so they test the shell alone. */
export function placeholder(id: TabId, title: string): TabModule<PlaceholderModel> {
  return {
    id,
    title,
    init: () => [{ title }, []],
    update: (model) => [model, []],
    View: PlaceholderView,
    hints: () => [],
    capturesText: () => false,
  };
}

export const TABS: Record<TabId, AnyTab> = {
  spools: spoolsTab,
  add: placeholder("add", "Add"),
  presets: presetsTab,
  check: checkTab,
  settings: settingsTab,
};

export const LABELS: AnyLabels = labelsOverlay;
