// ABOUTME: The Spools tab's dialogs: how many spools to add (then their results), a barcode scan, and its filament choices.
// ABOUTME: spoolsDialog hands the open one to the shell's dialog layer; each names what it acts on; keys are in the footer.

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";

import type { CopyableFilament } from "../../../spoolCopies.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  DIALOG_WIDTH,
  Dialog,
  dialogInner,
  dialogWidth,
  Line,
  LinkedText,
  List,
  type ListRow,
  listPosition,
  plural,
  type Segment,
  TextField,
  textWidth,
} from "../../ui/index.js";
import { swatchOf } from "./data.js";
import { wrapText } from "./local.js";
import {
  type ChooseDialog,
  type CountDialog,
  type KnownDialog,
  MAX_COPIES,
  type ScanDialog,
  type Dialog as SpoolsDialogState,
  type SpoolsModel,
} from "./model.js";

/** "1000 g on a 189 g spool", leaving out what the spool doesn't know. */
export function weightSummary(labelWeight: number | null, coreWeight: number | null): string {
  const net = labelWeight ? `${labelWeight} g` : "unknown weight";
  return coreWeight ? `${net} on a ${coreWeight} g spool` : `${net}, empty spool unknown`;
}

const blank = (width: number) => <Line segments={[]} width={width} />;

/** Sentences wrapped to the dialog, never cut. */
function Prose({
  text,
  width,
  color = COLORS.muted,
}: {
  text: string;
  width: number;
  color?: string;
}) {
  return (
    <>
      {wrapText(text, width).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines of one paragraph.
        <Line key={index} segments={[{ text: line, color }]} width={width} />
      ))}
    </>
  );
}

function chip(colorCodes: string[]): Segment[] {
  const color = swatchOf(colorCodes);
  return color ? [{ text: "  ", backgroundColor: color }, { text: " " }] : [];
}

/** The filament a dialog acts on: chip and name, then brand · material · weights · code. */
function FilamentHead({ filament, width }: { filament: CopyableFilament; width: number }) {
  const { spool } = filament;
  return (
    <>
      <Line
        segments={[...chip(spool.colorCodes), { text: filament.name, bold: true }]}
        width={width}
      />
      <Prose
        text={[
          spool.brand,
          [spool.material, spool.subtype].filter(Boolean).join(" "),
          weightSummary(spool.labelWeight, spool.coreWeight),
          filament.code,
        ]
          .filter(Boolean)
          .join(" · ")}
        width={width}
      />
    </>
  );
}

/** ‹ 2 ›: the arrow at a limit is dim, since that way goes no further. */
function Stepper({ count }: { count: number }): Segment[] {
  return [
    { text: "‹ ", color: count > 1 ? COLORS.accent : COLORS.muted },
    { text: String(count), color: COLORS.accent, bold: true },
    { text: " ›", color: count < MAX_COPIES ? COLORS.accent : COLORS.muted },
  ];
}

/** Prose wrapped to the dialog with a link at its end: on the last line when it fits there, else on its own. */
function ProseLink({ text, url, width }: { text: string; url: string; width: number }) {
  const lines = wrapText(text, width);
  const last = lines.pop() ?? "";
  const together = textWidth(`${last} ${url}`) <= width;
  return (
    <>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines of one paragraph.
        <Line key={index} segments={[{ text: line, color: COLORS.muted }]} width={width} />
      ))}
      {together ? null : <Line segments={[{ text: last, color: COLORS.muted }]} width={width} />}
      <Text wrap="truncate-end">
        {together ? <Text color={COLORS.muted}>{last} </Text> : null}
        <LinkedText parts={[{ text: url, url }]} />
      </Text>
    </>
  );
}

/** What a finished run did, in one line: every spool added, some, or none and why. */
export function copyOutcome(dialog: CountDialog): {
  text: string;
  tone: "ok" | "warning" | "failed";
} {
  if (dialog.error) return { text: `✗ Nothing added: ${dialog.error}`, tone: "failed" };
  const ids = dialog.results.flatMap((r) => (r.ok && r.id ? [`#${r.id}`] : []));
  const created = dialog.results.filter((r) => r.ok).length;
  const list = ids.length > 0 ? `: ${ids.join(", ")}` : "";
  if (created === dialog.results.length)
    return { text: `✓ ${plural(created, "spool")} added${list}`, tone: "ok" };
  if (created === 0) return { text: "✗ No spools added", tone: "failed" };
  return {
    text: `! ${created} of ${plural(dialog.results.length, "spool")} added${list}`,
    tone: "warning",
  };
}

const TONE_COLOR = { ok: COLORS.ok, warning: COLORS.warning, failed: COLORS.failed } as const;

function CountBody({ dialog, width }: { dialog: CountDialog; width: number }) {
  const { filament } = dialog;
  const outcome = dialog.phase === "done" ? copyOutcome(dialog) : null;
  return (
    <>
      <FilamentHead filament={filament} width={width} />
      {blank(width)}
      {dialog.phase === "choose" ? (
        <>
          <ProseLink
            text={`Copies of spool #${filament.spool.id} (the newest spool of this filament) go to`}
            url={dialog.url}
            width={width}
          />
          <Prose
            text={`The console has ${plural(filament.count, "spool")} of this filament. Only spool records are added.`}
            width={width}
          />
          {blank(width)}
          <Line
            segments={[
              { text: "How many  " },
              ...Stepper({ count: dialog.count }),
              { text: `  new ${dialog.count === 1 ? "spool" : "spools"}` },
            ]}
            width={width}
          />
        </>
      ) : outcome ? (
        <>
          <Prose text={outcome.text} width={width} color={TONE_COLOR[outcome.tone]} />
          {dialog.results.map((result, index) =>
            result.ok ? null : (
              <Prose
                // biome-ignore lint/suspicious/noArrayIndexKey: a failed copy has no ID; its number is its identity.
                key={index}
                text={`✗ spool ${index + 1}: ${result.error}`}
                width={width}
                color={COLORS.failed}
              />
            ),
          )}
        </>
      ) : (
        <Busy
          message={`Adding spool ${Math.min(dialog.results.length + 1, dialog.count)} of ${dialog.count}…`}
        />
      )}
    </>
  );
}

function ScanBody({
  dialog,
  model,
  width,
}: {
  dialog: ScanDialog;
  model: SpoolsModel;
  width: number;
}) {
  const known = model.barcodes?.size ?? 0;
  return (
    <>
      <Box flexDirection="row">
        <Line segments={[{ text: "Barcode  ", color: COLORS.muted }]} width={9} />
        <TextField
          value={dialog.text.value}
          cursor={dialog.text.cursor}
          focused
          placeholder="scan or type it"
          width={width - 9}
        />
      </Box>
      {dialog.error ? (
        <Prose text={dialog.error} width={width} color={COLORS.failed} />
      ) : (
        blank(width)
      )}
      {dialog.pending ? (
        <Busy message={`Looking up ${dialog.pending}…`} />
      ) : (
        <Prose
          text={
            model.barcodes === null
              ? "Reading the barcodes bambu-hando knows…"
              : known > 0
                ? `${plural(known, "barcode")} known; a new one asks which filament it is, once.`
                : "A new barcode asks which filament it is, once."
          }
          width={width}
        />
      )}
    </>
  );
}

function filamentRow(filament: CopyableFilament, label = filament.name): ListRow {
  const swatch = swatchOf(filament.spool.colorCodes);
  return {
    key: filament.code,
    ...(swatch ? { swatch } : {}),
    cells: [
      { text: label, grow: true },
      { text: plural(filament.count, "spool"), align: "right", dim: true, width: 9 },
    ],
  };
}

function KnownBody({ dialog, width }: { dialog: KnownDialog; width: number }) {
  const rows: ListRow[] = [
    filamentRow(dialog.filament, "More spools of it"),
    {
      key: "other",
      cells: [
        { text: "A different filament", grow: true },
        { text: "learned wrong?", dim: true, width: 14, align: "right" },
      ],
    },
  ];
  return (
    <>
      <Prose text="You told bambu-hando this barcode is" width={width} />
      <Line
        segments={[
          ...chip(dialog.filament.spool.colorCodes),
          { text: dialog.filament.name, bold: true },
        ]}
        width={width}
      />
      {blank(width)}
      <List rows={rows} cursor={dialog.cursor} height={2} width={width} />
    </>
  );
}

/** The last row of the filament choices: a filament the console has no spool of yet. */
const OTHER_ROW: ListRow = {
  key: "other",
  cells: [
    { text: "Other…", grow: true },
    { text: "find it in Add", dim: true, width: 14, align: "right" },
  ],
};

function ChooseBody({
  dialog,
  width,
  listHeight,
}: {
  dialog: ChooseDialog;
  width: number;
  listHeight: number;
}) {
  const rows = [...dialog.filaments.map((f) => filamentRow(f)), OTHER_ROW];
  return (
    <>
      <Prose
        text={
          dialog.gone
            ? `It was ${dialog.gone.name}, which no spool on the console is now.`
            : "Asked once, then remembered."
        }
        width={width}
      />
      {blank(width)}
      {dialog.saving ? (
        <Busy message={`Remembering barcode ${dialog.barcode}…`} />
      ) : (
        <List
          rows={rows}
          cursor={dialog.cursor}
          height={Math.max(1, Math.min(rows.length, listHeight))}
          width={width}
        />
      )}
    </>
  );
}

function title(dialog: SpoolsDialogState): string {
  switch (dialog.kind) {
    case "count":
      // The body says what's happening and what happened; the title stays what the dialog is.
      return "More spools like this one";
    case "scan":
      return "Scan a barcode";
    case "known":
      return `Barcode ${dialog.barcode}`;
    case "choose":
      return `Which filament is ${dialog.barcode}?`;
  }
}

/** Dialog rows other than the content: borders and padding, and the cleared row the shell keeps round it. */
const DIALOG_CHROME = 4 + 2;

export function SpoolsDialog({
  dialog,
  model,
  ctx,
}: {
  dialog: SpoolsDialogState;
  model: SpoolsModel;
  ctx: Ctx;
}) {
  const width = dialogWidth(ctx.bodyColumns, DIALOG_WIDTH + 8);
  const inner = dialogInner(width);
  let body: ReactNode;
  // Where the cursor is, when the choices scroll.
  let note = "";
  switch (dialog.kind) {
    case "count":
      body = <CountBody dialog={dialog} width={inner} />;
      break;
    case "scan":
      body = <ScanBody dialog={dialog} model={model} width={inner} />;
      break;
    case "known":
      body = <KnownBody dialog={dialog} width={inner} />;
      break;
    case "choose": {
      // Above the list: the line of prose (two when wrapped) and a blank.
      const prose = 3;
      const rows = dialog.filaments.length + 1;
      if (rows > ctx.bodyRows - DIALOG_CHROME - prose) note = listPosition(dialog.cursor, rows);
      body = (
        <ChooseBody
          dialog={dialog}
          width={inner}
          listHeight={ctx.bodyRows - DIALOG_CHROME - prose}
        />
      );
      break;
    }
  }
  // The footer shows the dialog's keys (the tab is modal), so the dialog doesn't repeat them.
  return (
    <Dialog title={title(dialog)} width={width} {...(note ? { note } : {})}>
      {body}
    </Dialog>
  );
}

/** The tab's open dialog for the shell to draw over the dimmed body, else null. */
export function spoolsDialog(model: SpoolsModel, ctx: Ctx): ReactElement | null {
  return model.dialog ? <SpoolsDialog dialog={model.dialog} model={model} ctx={ctx} /> : null;
}
