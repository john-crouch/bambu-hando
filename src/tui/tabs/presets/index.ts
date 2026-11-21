// ABOUTME: The Presets tab as the shell sees it: BambuStudio filament presets to look through, edit and save.
// ABOUTME: The editor (editor.ts, EditorView.tsx) is exported too, for the Add tab's review to embed.

import type { TabModule } from "../../core/types.js";
import {
  busy,
  capturesText,
  commands,
  hints,
  init,
  type PresetsModel,
  unsaved,
  update,
} from "./model.js";
import { PresetsView } from "./View.js";

export const presetsTab: TabModule<PresetsModel> = {
  id: "presets",
  title: "Presets",
  init,
  update,
  View: PresetsView,
  hints,
  capturesText,
  busy,
  unsaved,
  commands,
};

export { EditorView, type EditorViewProps, editorListRows } from "./EditorView.js";
export * from "./editor.js";
