// ABOUTME: The Presets tab's view: the list with its detail, the editor, or the review, filling the body.
// ABOUTME: Render-only; the model says which one is showing.

import type { Ctx } from "../../core/types.js";
import { EditorView } from "./EditorView.js";
import { ListView } from "./ListView.js";
import type { PresetsModel } from "./model.js";
import { ReviewView } from "./ReviewView.js";

export function PresetsView({ model, ctx }: { model: PresetsModel; ctx: Ctx }) {
  if (model.view === "review" && model.review)
    return <ReviewView review={model.review} ctx={ctx} />;
  if (model.view === "editor" && model.editor)
    return <EditorView model={model.editor.model} width={ctx.bodyColumns} height={ctx.bodyRows} />;
  return <ListView model={model} ctx={ctx} />;
}
