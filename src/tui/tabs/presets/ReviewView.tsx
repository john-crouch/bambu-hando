// ABOUTME: The review before a preset edit is saved: each change, the presets it goes into, SpoolEase's nozzle range.
// ABOUTME: After saving, the same page shows each preset's result and SpoolEase's.

import { Box } from "ink";

import {
  applyEdits,
  editedText,
  nozzleSpecific,
  type Preset,
  shownSetting,
  skippedDetail,
} from "../../../presetEdit.js";
import type { Ctx } from "../../core/types.js";
import { plural } from "../../ui/format.js";
import {
  Busy,
  type Cell,
  Line,
  type ListRow,
  listPosition,
  listWindow,
  Panel,
  panelInner,
  type Segment,
  textWidth,
} from "../../ui/index.js";
import { rowSegments } from "../../ui/List.js";
import { spaces, truncate } from "../../ui/text.js";
import { COLORS, ICONS } from "../../ui/theme.js";
import { CLOSE_BAMBUSTUDIO_FIRST, presetTitle, printerLabel } from "./detail.js";
import { editWarning, presetValueText, tidyUnits } from "./editor.js";
import { type ReviewModel, reviewRows, targetEdits } from "./model.js";

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
  return editWarning(key, editedText(edit));
}

const UPLOADS = "Logged in to Bambu, BambuStudio uploads the change on its next sync.";

const NOZZLE_NOTE =
  "Flow speed, pressure advance, retraction and raw settings belong to a nozzle size: they go into the preset you edited unless you tick the others.";

function Blank({ width }: { width: number }) {
  return <Line segments={[]} width={width} />;
}

/** A target's result once saved. */
function resultCell(review: ReviewModel, path: string, width: number): Cell {
  const result = review.results?.find((r) => r.path === path);
  if (!result) return { text: "- not saved", width, dim: true };
  return {
    text: truncate(`${result.ok ? ICONS.ok : ICONS.failed} ${result.detail || "saved"}`, width),
    width,
    color: result.ok ? (result.detail ? COLORS.warning : COLORS.ok) : COLORS.failed,
  };
}

/** What a change does to one target, from its settings as read: the values before and after. */
type TargetChange =
  | { state: "change"; before: string; after: string }
  | { state: "same"; before: string }
  | { state: "skip"; before: string; detail: string }
  | { state: "reading" }
  | { state: "failed"; detail: string };

function targetChange(review: ReviewModel, key: string, path: string): TargetChange {
  const file = review.contents.get(path);
  if (!file || file.state === "loading") return { state: "reading" };
  if (file.state === "failed") return { state: "failed", detail: file.error };
  const edit = review.edits.get(key);
  const preset = file.preset;
  const text = (p: Preset) => presetValueText(key, p) ?? tidyUnits(shownSetting(key, p[key]));
  if (!edit) return { state: "same", before: text(preset) };
  const single = new Map([[key, edit]]);
  const { preset: edited, skipped } = applyEdits(preset, single);
  if (skipped.length > 0)
    return { state: "skip", before: text(preset), detail: skippedDetail(preset, single, skipped) };
  if (JSON.stringify(preset[key]) === JSON.stringify(edited[key]))
    return { state: "same", before: text(preset) };
  return { state: "change", before: text(preset), after: text(edited) };
}

/** A row's last cell: where the change stands for that target. */
function changeCell(change: TargetChange, ticked: boolean): Cell {
  switch (change.state) {
    case "reading":
      return { text: "reading it…", grow: true, color: COLORS.muted };
    case "failed":
      return { text: `${ICONS.failed} ${change.detail}`, grow: true, color: COLORS.failed };
    case "skip":
      return { text: change.detail, grow: true, color: COLORS.warning };
    case "same":
      return { text: ticked ? "already so" : "stays", grow: true, dim: true };
    case "change":
      return ticked
        ? { text: `→ ${change.after}`, grow: true, color: COLORS.accent }
        : { text: "stays", grow: true, dim: true };
  }
}

/** The review's lines: each change's rows (one per target), then its warning; rows carry their index. */
type ReviewLine = { row: number; listRow: ListRow } | { row: null; segments: Segment[] };

function reviewLines(review: ReviewModel, width: number): ReviewLine[] {
  const rows = reviewRows(review);
  const changes = rows.map((row) => targetChange(review, row.key, row.path));
  const labels = new Map(review.changes.map((c) => [c.key, c.label]));
  const names = new Map(
    review.targets.map((t) => [t.path, printerLabel(t.printer) || presetTitle(t)]),
  );
  // Each column a space wider than its widest, so columns sit two apart.
  const labelWidth =
    Math.min(30, Math.max(0, ...review.changes.map((c) => textWidth(c.label)))) + 1;
  const nameWidth = Math.max(0, ...[...names.values()].map(textWidth)) + 1;
  const befores = changes.map((c) => ("before" in c ? c.before : ""));
  const resultWidth = review.results
    ? Math.max(...review.targets.map((t) => textWidth(resultCell(review, t.path, 48).text))) + 1
    : 0;
  // Past the cursor's bar, the marker and the fixed columns, each with the space List puts after it.
  const room =
    width - 1 - 4 - (labelWidth + 1) - (nameWidth + 1) - (resultWidth ? resultWidth + 1 : 0);
  const widest = Math.max(0, ...befores.map(textWidth));
  const afters = rows.map((row, index) =>
    textWidth(changeCell(changes[index] as TargetChange, review.ticked.has(row.id)).text),
  );
  // Before and after side by side when every row's fit; else after under before; on a narrow
  // terminal both on lines of their own under the row, wrapped: never cut.
  const stacked = widest + 2 + Math.max(0, ...afters) > room;
  const deep = stacked && Math.max(widest, ...afters) > room;
  const beforeWidth = stacked ? 0 : widest + 1;
  const indent = 1 + 4 + 2;
  const valueLines = (text: string, style: Partial<Segment>): ReviewLine[] =>
    wrapWords(text, Math.max(8, width - indent)).map((part) => ({
      row: null,
      segments: [{ text: spaces(indent) }, { text: part, ...style }],
    }));
  const lines: ReviewLine[] = [];
  rows.forEach((row, index) => {
    const ticked = review.ticked.has(row.id);
    const change = changes[index] as TargetChange;
    const lead: Cell[] = [
      {
        text: row.first ? (labels.get(row.key) ?? row.key) : "",
        width: labelWidth,
        color: COLORS.muted,
      },
      { text: names.get(row.path) ?? row.path, width: nameWidth },
      ...(review.results
        ? [ticked ? resultCell(review, row.path, resultWidth) : { text: "", width: resultWidth }]
        : []),
    ];
    const before: Cell = stacked
      ? { text: befores[index] ?? "", grow: true, dim: true }
      : { text: befores[index] ?? "", width: beforeWidth, dim: true };
    const after = changeCell(change, ticked);
    const style = (cell: Cell): Partial<Segment> => ({
      ...(cell.color ? { color: cell.color } : {}),
      ...(cell.dim ? { dim: true } : {}),
    });
    if (deep) {
      // The printer takes the rest of the row; the values follow on lines of their own.
      const named: Cell[] = lead.map((cell, at) =>
        at === 1 ? { text: cell.text, grow: true } : cell,
      );
      lines.push({ row: index, listRow: { key: row.id, cells: named, ticked } });
      if (before.text) lines.push(...valueLines(before.text, { dim: true }));
      lines.push(...valueLines(after.text, style(after)));
    } else {
      const cells = stacked ? [...lead, before] : [...lead, before, after];
      lines.push({ row: index, listRow: { key: row.id, cells, ticked } });
    }
    if (stacked && !deep)
      lines.push({
        row: null,
        segments: [
          { text: spaces(Math.max(0, width - room)) },
          {
            text: after.text,
            ...(after.color ? { color: after.color } : {}),
            ...(after.dim ? { dim: true } : {}),
          },
        ],
      });
    const last = rows[index + 1]?.key !== row.key;
    if (!last) return;
    const warning = changeWarning(review, row.key);
    if (!warning) return;
    // Under the values: past the marker, the label and the printer.
    const indent = Math.min(Math.floor(width / 2), 1 + 4 + labelWidth + 1 + nameWidth + 1);
    wrapWords(warning, Math.max(8, width - indent - 2)).forEach((text, at) => {
      lines.push({
        row: null,
        segments: [
          { text: `${spaces(indent)}${at === 0 ? `${ICONS.warning} ` : "  "}` },
          { text, color: COLORS.warning },
        ],
      });
    });
  });
  return lines;
}

/** The line under the results: what's next once saved, and how many failed. */
function outcome(review: ReviewModel): Segment[] {
  const total = review.results?.length ?? 0;
  const saved = review.results?.filter((r) => r.ok).length ?? 0;
  const failed = total - saved;
  const next =
    saved === 0
      ? ""
      : failed
        ? `restart BambuStudio to load the saved ${saved === 1 ? "one" : "ones"}`
        : "Restart BambuStudio to load the change";
  if (failed === 0 && review.spoolease?.ok !== false)
    return [{ text: ` ${ICONS.ok} ${next}`, color: COLORS.ok, bold: true }];
  const failedText = failed
    ? `${failed} of ${plural(total, "preset")} failed${next ? `: ${next}` : ""}`
    : `${next}; SpoolEase's range is unchanged`;
  return [{ text: ` ${ICONS.failed} ${failedText}`, color: COLORS.failed, bold: true }];
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
  const spoolease = spooleaseLine(review);
  const checking = review.range.state === "checking" && review.phase === "review";
  const before = review.phase === "review";
  const noteLines = (text: string, lead: number) =>
    wrapWords(text, Math.max(8, w - 2 - lead)).length;
  const nozzleNote =
    before && review.targets.length > 1 && review.changes.some((c) => nozzleSpecific(c.key));
  // The heading, the notes, the gaps between them, SpoolEase's line and the status line take what
  // they need; the changes' lines get the rest, scrolled to the cursor.
  const fixed =
    1 +
    (nozzleNote ? noteLines(NOZZLE_NOTE, 0) : 0) +
    1 +
    (before ? noteLines(CLOSE_BAMBUSTUDIO_FIRST, 2) + 1 : 0) +
    (spoolease.length || checking ? 2 : 0) +
    (before ? noteLines(UPLOADS, 0) + 1 : 0) +
    1;
  const room = Math.max(1, inner.height - fixed);
  const lines = reviewLines(review, w);
  const at = Math.max(
    0,
    lines.findIndex((line) => line.row === review.cursor),
  );
  const { start, end } = listWindow(at, lines.length, room);
  const status: Segment[] | null = review.error
    ? [{ text: ` ${ICONS.failed} ${review.error}`, color: COLORS.failed }]
    : review.phase === "done"
      ? outcome(review)
      : null;
  const presets = targetEdits(review).length;
  const into = review.results ? review.results.length : presets;
  return (
    <Panel
      title="Save changes"
      subtitle={presetTitle(review.preset)}
      focused
      width={width}
      height={height}
      {...(lines.length > room
        ? { footerRight: listPosition(review.cursor, reviewRows(review).length) }
        : {})}
    >
      <Line
        segments={[
          { text: ` ${plural(review.changes.length, "change")}`, bold: true },
          { text: ` · into ${plural(into, "preset")}`, color: COLORS.muted },
        ]}
        width={w}
      />
      <Box flexDirection="column" height={Math.min(room, lines.length)} flexShrink={0}>
        {lines.slice(start, end).map((line, offset) => (
          <Line
            // biome-ignore lint/suspicious/noArrayIndexKey: positional lines of the window.
            key={start + offset}
            width={w}
            segments={
              line.row === null
                ? line.segments
                : rowSegments(line.listRow, w, {
                    selected: before && line.row === review.cursor,
                    focused: before,
                    marker: !review.results,
                    chip: false,
                    thumb: false,
                  })
            }
          />
        ))}
      </Box>
      {nozzleNote ? <Note text={NOZZLE_NOTE} color={COLORS.muted} width={w} /> : null}
      <Blank width={w} />
      {before ? (
        <>
          <Note
            text={CLOSE_BAMBUSTUDIO_FIRST}
            icon={ICONS.warning}
            color={COLORS.warning}
            width={w}
          />
          <Blank width={w} />
        </>
      ) : null}
      {checking ? (
        <Box paddingLeft={1}>
          <Busy message="Reading SpoolEase's nozzle range…" />
        </Box>
      ) : spoolease.length ? (
        <Line segments={spoolease} width={w} />
      ) : null}
      {spoolease.length || checking ? <Blank width={w} /> : null}
      {before ? (
        <>
          <Note text={UPLOADS} color={COLORS.muted} width={w} />
          <Blank width={w} />
        </>
      ) : null}
      {review.phase === "saving" ? (
        <Box paddingLeft={1}>
          <Busy message={`Saving ${plural(presets, "preset")}…`} />
        </Box>
      ) : status ? (
        <Line segments={status} width={w} />
      ) : null}
    </Panel>
  );
}
