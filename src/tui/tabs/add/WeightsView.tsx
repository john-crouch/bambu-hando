// ABOUTME: The Weights page: the empty spool weight choices for one brand, and every brand with its weight so far.
// ABOUTME: Render-only; the items and the step come from the model through weights.ts and update.ts.

import { Box } from "ink";

import type { WeightChoice } from "../../../spoolWeights.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  Empty,
  Line,
  List,
  listPosition,
  Panel,
  panelInner,
  type Segment,
} from "../../ui/index.js";
import { COLORS } from "../../ui/theme.js";
import { pageArea, splitPage } from "./layout.js";
import type { AddModel } from "./model.js";
import { currentWeightItems } from "./update.js";

function choiceText(choice: WeightChoice | undefined, sourceName: string): string {
  if (!choice) return "";
  if (choice.kind === "grams") return `${choice.grams} g`;
  return choice.kind === "source" ? `${sourceName}'s weight` : "unspecified";
}

const muted = (text: string): Segment => ({ text, color: COLORS.muted });

export function WeightsView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const area = pageArea(ctx.bodyColumns, ctx.bodyRows);
  const { weights } = model;
  if (weights.state !== "ready") {
    const inner = panelInner(area.width, area.height);
    return (
      <Panel title="Empty spool weight" focused width={area.width} height={area.height}>
        {weights.state === "failed" ? (
          <Empty
            title="Couldn't read SpoolEase's spool weights"
            lines={[weights.error]}
            action={
              weights.keyRejected
                ? { keys: "s", label: "fix it in Settings · r try again" }
                : { keys: "r", label: "try again" }
            }
            width={inner.width}
            height={inner.height}
          />
        ) : (
          <Box paddingLeft={1}>
            <Busy message="Reading spool weights from SpoolEase…" />
          </Box>
        )}
      </Panel>
    );
  }

  const split = splitPage(area);
  const group = weights.prompts[weights.step];
  const items = currentWeightItems(model);
  const chosen = group ? model.weightChoices.get(group.key) : undefined;
  const list = panelInner(split.list.width, split.list.height);
  const names = (group?.profiles ?? []).map((i) => weights.profiles[i]?.name ?? "");
  const why =
    group && group.options.length > 0
      ? "SpoolEase lists several spools for this brand: which is yours?"
      : "SpoolEase's spool lists don't have this brand.";
  const detail = panelInner(split.detail.width, split.detail.height);

  return (
    <Box flexDirection={split.side ? "row" : "column"} flexShrink={0}>
      <Panel
        title={`Empty spool weight · ${group?.brand || "no brand"}`}
        subtitle={`brand ${weights.step + 1} of ${weights.prompts.length}`}
        focused
        width={split.list.width}
        height={split.list.height}
        footerRight={listPosition(weights.cursor, items.length)}
      >
        <Line width={list.width} segments={[{ text: " " }, muted(names.join(", "))]} />
        <Line width={list.width} segments={[{ text: " " }, muted(why)]} />
        <Line width={list.width} segments={[]} />
        <List
          rows={items.map((item) => {
            const picked = JSON.stringify(item.choice) === JSON.stringify(chosen);
            return {
              key: item.label,
              cells: [
                picked
                  ? { text: "●", width: 1, color: COLORS.ok }
                  : { text: "○", width: 1, color: COLORS.muted },
                { text: item.label, grow: true },
                {
                  text: item.detail,
                  width: Math.min(28, Math.max(8, Math.floor(list.width / 3))),
                  dim: true,
                },
              ],
            };
          })}
          cursor={weights.cursor}
          height={Math.max(0, list.height - 3)}
          width={list.width}
        />
      </Panel>
      {split.detail.height >= 3 ? (
        <Panel title="Brands" width={split.detail.width} height={split.detail.height}>
          {weights.groups.map((g) => {
            const asked = weights.prompts.indexOf(g);
            const choice = model.weightChoices.get(g.key);
            const status: Segment[] =
              asked < 0
                ? [muted(`${g.options[0]?.grams ?? 0} g · SpoolEase's only row`)]
                : choice
                  ? [{ text: choiceText(choice, "the source"), color: COLORS.ok }]
                  : [muted(asked === weights.step ? "choosing…" : "to choose")];
            const mark: Segment =
              asked === weights.step
                ? { text: " ▸ ", color: COLORS.accent }
                : choice || asked < 0
                  ? { text: " ✓ ", color: COLORS.ok }
                  : { text: "   " };
            return (
              <Line
                key={g.key || g.brand}
                width={detail.width}
                segments={[mark, { text: `${g.brand || "no brand"}  ` }, ...status]}
              />
            );
          })}
          {weights.warnings.map((w) => (
            <Line
              key={w}
              width={detail.width}
              segments={[{ text: ` ! ${w}`, color: COLORS.warning }]}
            />
          ))}
        </Panel>
      ) : null}
    </Box>
  );
}
