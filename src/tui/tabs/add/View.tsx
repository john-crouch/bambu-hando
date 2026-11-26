// ABOUTME: The Add tab's body: page bar, the current page (Find, Weights, Review, Done), and the status line.
// ABOUTME: The Other color dialog goes to the shell's dialog layer (addDialog); everything is sized from ctx's body.

import { Box } from "ink";
import type { ReactElement } from "react";

import type { Ctx } from "../../core/types.js";
import { shortPrinter } from "../../ui/format.js";
import { Line, PageBar, type Segment } from "../../ui/index.js";
import { COLORS } from "../../ui/theme.js";
import { EditorView } from "../presets/index.js";
import { ColorDialogView } from "./ColorDialogView.js";
import { trayText } from "./catalog.js";
import { FindView } from "./FindView.js";
import { pageArea } from "./layout.js";
import { type AddModel, catalogWarnings, ticked } from "./model.js";
import { PlanView } from "./PlanView.js";
import { TdfpPlanView } from "./TdfpView.js";
import { showsTdfp, tdfpTray } from "./tdfp.js";
import { pageBar } from "./update.js";
import { WeightsView } from "./WeightsView.js";

/** The bottom line: what the last key needs, else a warning, else what's ticked across brands. */
export function statusSegments(model: AddModel, ctx: Ctx): Segment[] {
  if (model.notice) return [{ text: ` ! ${model.notice}`, color: COLORS.warning }];
  if (showsTdfp(model)) return tdfpStatus(model);
  if (model.page === "review" && model.review.editing) {
    // The footer says esc keeps the edits; this line says where they go.
    const { editor } = model.review.editing;
    return [
      {
        text: ` ✎ The run writes this preset for ${shortPrinter(editor.printer)} with these changes`,
        color: COLORS.muted,
      },
    ];
  }
  const [warning] = model.page === "find" ? catalogWarnings(ctx) : [];
  if (warning) return [{ text: ` ! ${warning}`, color: COLORS.warning }];
  if (model.run?.state === "done" && model.run.results.length > 0)
    return [{ text: " Selection cleared for the next run", color: COLORS.muted }];
  const tray = trayText(ticked(model, ctx));
  if (!tray) return [{ text: " Nothing ticked yet: space ticks a color", color: COLORS.muted }];
  const [count = "", rest = ""] = tray.split(": ");
  return [
    { text: ` ✓ ${count}`, color: COLORS.ok, bold: true },
    { text: `  ${rest}`, color: COLORS.muted },
  ];
}

/** The import's bottom line: the list's warning, else what's ticked. */
function tdfpStatus(model: AddModel): Segment[] {
  const { run, list } = model.tdfp;
  if (run?.state === "done")
    return [{ text: " Imported spools are linked now", color: COLORS.muted }];
  const [warning] = list.warnings;
  if (warning && model.page === "find") return [{ text: ` ! ${warning}`, color: COLORS.warning }];
  const tray = tdfpTray(model);
  if (!tray) return [{ text: " Nothing ticked yet: space ticks a spool", color: COLORS.muted }];
  const [count = "", rest = ""] = tray.split(": ");
  return [
    { text: ` ✓ ${count}`, color: COLORS.ok, bold: true },
    { text: `  ${rest}`, color: COLORS.muted },
  ];
}

/** The Other color dialog, for the shell to draw over the dimmed body; null when it's closed. */
export function addDialog(model: AddModel, ctx: Ctx): ReactElement | null {
  return model.page === "find" && model.dialog ? (
    <ColorDialogView dialog={model.dialog} columns={ctx.bodyColumns} />
  ) : null;
}

export function AddView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const width = ctx.bodyColumns;
  const area = pageArea(width, ctx.bodyRows);
  return (
    <Box flexDirection="column" width={width} height={ctx.bodyRows} flexShrink={0}>
      <PageBar pages={pageBar(model, ctx)} width={width} />
      <Box height={area.height} width={width} flexShrink={0} overflow="hidden">
        {model.page === "find" ? (
          <FindView model={model} ctx={ctx} />
        ) : model.page === "weights" ? (
          <WeightsView model={model} ctx={ctx} />
        ) : model.tdfp.active ? (
          <TdfpPlanView model={model} ctx={ctx} />
        ) : model.page === "review" && model.review.editing ? (
          <EditorView model={model.review.editing.editor} width={width} height={area.height} />
        ) : (
          <PlanView model={model} ctx={ctx} />
        )}
      </Box>
      <Line width={width} segments={statusSegments(model, ctx)} />
    </Box>
  );
}
