// ABOUTME: The review before a preset edit is saved: each change, the presets it goes into, SpoolEase's nozzle range.
// ABOUTME: After saving, the same page shows each preset's result and SpoolEase's.

import { Box } from "ink";

import type { Ctx } from "../../core/types.js";
import { plural } from "../../ui/format.js";
import {
  Busy,
  Line,
  List,
  type ListRow,
  Panel,
  panelInner,
  type Segment,
  textWidth,
} from "../../ui/index.js";
import { spaces } from "../../ui/text.js";
import { COLORS, ICONS } from "../../ui/theme.js";
import { presetTitle, printerLabel } from "./detail.js";
import { editWarning } from "./editor.js";
import type { ReviewModel } from "./model.js";

/** Words in lines of at most width columns: a note is never cut mid-sentence. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return [...lines, line];
}

/** A note's lines, indented, its icon (if any) hanging in front of the first. */
function Note({
  text,
  icon,
  color,
  width,
}: {
  text: string;
  icon?: string;
  color: string;
  width: number;
}) {
  const lead = icon ? `${icon} ` : "";
  const lines = wrapWords(text, Math.max(8, width - 2 - textWidth(lead)));
  return (
    <>
      {lines.map((line, index) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: positional lines of one note.
          key={index}
          segments={[{ text: ` ${index === 0 ? lead : spaces(textWidth(lead))}${line}`, color }]}
          width={width}
        />
      ))}
    </>
  );
}

/** Why the edit of key looks wrong ("5°C is unusually low…"); "" when it looks fine. */
function changeWarning(review: ReviewModel, key: string): string {
  const edit = review.edits.get(key);
  if (!edit) return "";
  return editWarning(key, "every" in edit ? edit.every : (edit.each[0] ?? ""));
}

/** The targets list's widest before saving: a printer's note stays near its name on a wide terminal. */
const TARGETS_MAX = 72;

const CLOSE_FIRST = "Close BambuStudio first: it may save its own copy over these presets.";
const UPLOADS = "Logged in to Bambu, BambuStudio uploads the change on its next sync.";

function Heading({ text, width }: { text: string; width: number }) {
  return <Line segments={[{ text: ` ${text}`, bold: true }]} width={width} />;
}

function Blank({ width }: { width: number }) {
  return <Line segments={[]} width={width} />;
}

function targetRows(review: ReviewModel): ListRow[] {
  const resultWidth = Math.max(
    0,
    ...(review.results ?? []).map((r) => Math.min(48, textWidth(r.detail || "saved") + 2)),
  );
  return review.targets.map((target, index) => {
    const result = review.results?.find((r) => r.path === target.path);
    const note = index === 0 ? "the one you edited" : "same filament ID";
    const name = printerLabel(target.printer) || presetTitle(target);
    const cells: ListRow["cells"] = [
      { text: name, grow: true },
      { text: note, width: 18, dim: true },
    ];
    if (review.results)
      cells.push(
        result
          ? {
              text: `${result.ok ? ICONS.ok : ICONS.failed} ${result.detail || "saved"}`,
              width: resultWidth,
              color: result.ok ? (result.detail ? COLORS.warning : COLORS.ok) : COLORS.failed,
            }
          : { text: "- not saved", width: resultWidth, dim: true },
      );
    return { key: target.path, cells, ticked: review.ticked.has(target.path) };
  });
}

/** What happens to SpoolEase's custom filament, before and after saving. */
function spooleaseLine(review: ReviewModel): Segment[] {
  if (review.spoolease)
    return [
      {
        text: ` ${review.spoolease.ok ? ICONS.ok : ICONS.failed} ${review.spoolease.line}`,
        color: review.spoolease.ok ? COLORS.ok : COLORS.failed,
      },
    ];
  const range = review.range;
  if (range.state === "change")
    return [
      { text: " SpoolEase  ", color: COLORS.muted },
      { text: `custom filament ${range.change.code}'s nozzle range ` },
      { text: range.change.from, dim: true },
      { text: " → " },
      { text: range.change.to, color: COLORS.accent, bold: true },
    ];
  if (range.state === "warning")
    return [{ text: ` ${ICONS.warning} ${range.warning}`, color: COLORS.warning }];
  return [];
}

export function ReviewView({ review, ctx }: { review: ReviewModel; ctx: Ctx }) {
  const width = ctx.bodyColumns;
  const height = ctx.bodyRows;
  const inner = panelInner(width, height);
  const w = inner.width;
  const labelWidth = Math.min(30, Math.max(0, ...review.changes.map((c) => textWidth(c.label))));
  const saved = review.results?.filter((r) => r.ok).length ?? 0;
  const failed = (review.results?.length ?? 0) - saved;
  const spoolease = spooleaseLine(review);
  const checking = review.range.state === "checking" && review.phase === "review";
  const noteLines = (text: string, lead: number) =>
    wrapWords(text, Math.max(8, w - 2 - lead)).length;
  const notes = review.phase === "review" ? noteLines(CLOSE_FIRST, 2) + noteLines(UPLOADS, 0) : 0;
  // Headings, gaps, the targets, SpoolEase's line, the notes and the status line take what they need.
  const fixed =
    5 + review.targets.length + (spoolease.length || checking ? 2 : 0) + notes + (notes ? 1 : 0);
  // A change takes a line, and one more for its warning.
  const heights = review.changes.map((c) => (changeWarning(review, c.key) ? 2 : 1));
  const room = Math.max(1, inner.height - fixed);
  const fits = (count: number, left: number) =>
    heights.slice(0, count).reduce((sum, h) => sum + h, 0) <= left;
  let shown = review.changes.length;
  if (!fits(shown, room)) {
    shown = 0;
    while (shown < review.changes.length && fits(shown + 1, room - 1)) shown++;
  }
  const status: Segment[] | null = review.error
    ? [{ text: ` ${ICONS.failed} ${review.error}`, color: COLORS.failed }]
    : review.phase === "done"
      ? [
          {
            text: ` ${failed || review.spoolease?.ok === false ? ICONS.failed : ICONS.ok} ${plural(saved, "preset")} saved${failed ? `, ${failed} failed` : ""}: restart BambuStudio to load ${saved === 1 ? "it" : "them"}`,
            color: failed || review.spoolease?.ok === false ? COLORS.failed : COLORS.ok,
            bold: true,
          },
        ]
      : null;
  const ticked = review.ticked.size;
  return (
    <Panel
      title={review.phase === "done" ? "Saved" : "Save changes"}
      subtitle={presetTitle(review.preset)}
      focused
      width={width}
      height={height}
    >
      <Heading text={plural(review.changes.length, "change")} width={w} />
      {review.changes.slice(0, shown).map((change) => {
        const warning = changeWarning(review, change.key);
        return (
          <Box key={change.key} flexDirection="column">
            <Line
              width={w}
              segments={[
                { text: "   " },
                { text: change.label.padEnd(labelWidth), color: COLORS.muted },
                { text: "  " },
                { text: change.from, dim: true },
                { text: " → " },
                { text: change.to, color: COLORS.accent, bold: true },
              ]}
            />
            {warning ? (
              <Line
                width={w}
                segments={[
                  { text: `   ${spaces(labelWidth)}  ` },
                  { text: `${ICONS.warning} ${warning}`, color: COLORS.warning },
                ]}
              />
            ) : null}
          </Box>
        );
      })}
      {shown < review.changes.length ? (
        <Line
          segments={[{ text: `   … ${review.changes.length - shown} more`, color: COLORS.muted }]}
          width={w}
        />
      ) : null}
      <Blank width={w} />
      {notes ? (
        <Note text={CLOSE_FIRST} icon={ICONS.warning} color={COLORS.warning} width={w} />
      ) : null}
      <Heading
        text={
          review.phase === "review"
            ? `Into ${plural(ticked, "preset")} of ${review.preset.name}`
            : `Into ${plural(review.results?.length ?? ticked, "preset")}`
        }
        width={w}
      />
      <Box paddingLeft={2}>
        <List
          rows={targetRows(review)}
          cursor={review.cursor}
          height={review.targets.length}
          width={review.results ? w - 2 : Math.min(w - 2, TARGETS_MAX)}
          marker="check"
          focused={review.phase === "review"}
        />
      </Box>
      <Blank width={w} />
      {checking ? (
        <Box paddingLeft={1}>
          <Busy message="Reading SpoolEase's nozzle range…" />
        </Box>
      ) : spoolease.length ? (
        <Line segments={spoolease} width={w} />
      ) : null}
      {spoolease.length || checking ? <Blank width={w} /> : null}
      {notes ? (
        <>
          <Note text={UPLOADS} color={COLORS.muted} width={w} />
          <Blank width={w} />
        </>
      ) : null}
      {review.phase === "saving" ? (
        <Box paddingLeft={1}>
          <Busy message={`Saving ${plural(ticked, "preset")}…`} />
        </Box>
      ) : status ? (
        <Line segments={status} width={w} />
      ) : null}
    </Panel>
  );
}
