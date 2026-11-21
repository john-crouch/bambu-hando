// ABOUTME: The Weights page: the empty spool weight choices for one brand, and every brand with its weight so far.
// ABOUTME: Render-only; the items and the step come from the model through weights.ts and update.ts.

import { Box } from "ink";

import type { WeightChoice } from "../../../spoolWeights.js";
import type { Ctx } from "../../core/types.js";
import { formatGrams } from "../../ui/format.js";
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
import { textWidth } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import { pageArea, splitPage } from "./layout.js";
import type { AddModel } from "./model.js";
import { currentWeightItems } from "./update.js";
import { wrapText } from "./wrap.js";

function choiceText(choice: WeightChoice | undefined, sourceName: string): string {
  if (!choice) return "";
  if (choice.kind === "grams") return formatGrams(choice.grams);
  return choice.kind === "source" ? sourceName : "unspecified";
}

const muted = (text: string): Segment => ({ text, color: COLORS.muted });
const plain = (text: string): Segment => ({ text });

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
  const detail = panelInner(split.detail.width, split.detail.height);
  const names = (group?.profiles ?? []).map((i) => weights.profiles[i]?.name ?? "");
  const why =
    group && group.options.length > 0
      ? "SpoolEase lists several spools for this brand: which is yours?"
      : "SpoolEase's spool lists don't have this brand.";
  const prose = (text: string, lines = Number.POSITIVE_INFINITY) =>
    wrapText(text, Math.max(1, list.width - 1), lines);
  // A short panel keeps its rows for the choices: one line each for the names and the question.
  const introLines = list.height >= 14 ? 2 : 1;
  const intro = [
    ...prose(names.join(", "), introLines).map(muted),
    ...prose(why, introLines).map(plain),
  ];
  const weightWidth = Math.max(5, ...items.map((i) => textWidth(i.weight)));
  const item = items[weights.cursor];
  const side = (text: string) => wrapText(text, Math.max(1, detail.width - 1));

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
        {intro.map((segment, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional prose lines.
          <Line key={index} width={list.width} segments={[{ text: " " }, segment]} />
        ))}
        <Line width={list.width} segments={[]} />
        <List
          rows={items.map((it) => {
            const picked = JSON.stringify(it.choice) === JSON.stringify(chosen);
            return {
              key: it.label,
              cells: [
                picked
                  ? { text: "●", width: 1, color: COLORS.ok }
                  : { text: "○", width: 1, color: COLORS.muted },
                { text: it.label, grow: true },
                { text: it.weight, width: weightWidth, align: "right" as const, dim: true },
              ],
            };
          })}
          cursor={weights.cursor}
          height={Math.max(0, list.height - intro.length - 1)}
          width={list.width}
        />
      </Panel>
      {split.detail.height >= 3 ? (
        <Panel
          title={item?.label ?? "Brands"}
          width={split.detail.width}
          height={split.detail.height}
        >
          {item ? (
            <>
              {side(`${item.weight === "–" ? "" : `${item.weight}. `}${item.detail}`).map(
                (line) => (
                  <Line key={line} width={detail.width} segments={[{ text: " " }, plain(line)]} />
                ),
              )}
              <Line width={detail.width} segments={[]} />
            </>
          ) : null}
          {weights.groups.map((g) => {
            const asked = weights.prompts.indexOf(g);
            const choice = model.weightChoices.get(g.key);
            const status: Segment[] =
              asked < 0
                ? [muted(`${formatGrams(g.options[0]?.grams ?? 0)} · SpoolEase's only row`)]
                : choice
                  ? [{ text: choiceText(choice, "as listed"), color: COLORS.ok }]
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
          <Line width={detail.width} segments={[]} />
          {side(
            "A new spool starts with its empty spool's weight: SpoolEase subtracts it from what the scale reads.",
          ).map((line) => (
            <Line key={line} width={detail.width} segments={[{ text: " " }, muted(line)]} />
          ))}
          {weights.warnings.flatMap(side).map((line) => (
            <Line
              key={line}
              width={detail.width}
              segments={[{ text: ` ! ${line}`, color: COLORS.warning }]}
            />
          ))}
        </Panel>
      ) : null}
    </Box>
  );
}
