// ABOUTME: The Spools tab's dialogs: how many spools to add (then their results), a barcode scan, and its filament choices.
// ABOUTME: Each names what it acts on (the filament, the spool it copies, the console) before anything is written.

import { Box, Text } from "ink";
import type { ReactNode } from "react";

import type { CopyableFilament } from "../../../spoolCopies.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  DIALOG_WIDTH,
  Dialog,
  dialogInner,
  Line,
  LinkedText,
  List,
  type ListRow,
  type Segment,
  TextField,
} from "../../ui/index.js";
import { swatchOf } from "./data.js";
import {
  type ChooseDialog,
  type CountDialog,
  dialogHints,
  type KnownDialog,
  MAX_COPIES,
  type ScanDialog,
  type Dialog as SpoolsDialogState,
  type SpoolsModel,
} from "./model.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "1000 g on a 189 g spool", leaving out what the spool doesn't know. */
export function weightSummary(labelWeight: number | null, coreWeight: number | null): string {
  const net = labelWeight ? `${labelWeight} g` : "unknown weight";
  return coreWeight ? `${net} on a ${coreWeight} g spool` : `${net}, empty spool unknown`;
}

const blank = (width: number) => <Line segments={[]} width={width} />;

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
      <Line
        segments={[
          {
            text: [
              spool.brand,
              [spool.material, spool.subtype].filter(Boolean).join(" "),
              weightSummary(spool.labelWeight, spool.coreWeight),
              filament.code,
            ]
              .filter(Boolean)
              .join(" · "),
            color: COLORS.muted,
          },
        ]}
        width={width}
      />
    </>
  );
}

function CountBody({ dialog, width }: { dialog: CountDialog; width: number }) {
  const { filament } = dialog;
  const created = dialog.results.filter((r) => r.ok).length;
  const failed = dialog.results.length - created;
  return (
    <>
      <FilamentHead filament={filament} width={width} />
      {blank(width)}
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>Copies of spool #{filament.spool.id} go to </Text>
        <LinkedText parts={[{ text: dialog.url, url: dialog.url }]} />
      </Text>
      <Line
        segments={[
          {
            text: `It has ${plural(filament.count, "spool")} of it now. Only spool records are added.`,
            color: COLORS.muted,
          },
        ]}
        width={width}
      />
      {blank(width)}
      {dialog.phase === "choose" ? (
        <Line
          segments={[
            { text: "How many  " },
            { text: dialog.count > 1 ? "‹ " : "  ", color: COLORS.accent },
            { text: String(dialog.count), color: COLORS.accent, bold: true },
            { text: dialog.count < MAX_COPIES ? " ›" : "  ", color: COLORS.accent },
            { text: `  new ${dialog.count === 1 ? "spool" : "spools"}` },
          ]}
          width={width}
        />
      ) : (
        <>
          {dialog.results.map((result, index) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: a failed copy has no ID; its number is its identity, and results only grow, in order.
              key={index}
              segments={
                result.ok
                  ? [{ text: `✓ spool #${result.id} added`, color: COLORS.ok }]
                  : [
                      {
                        text: `✗ spool ${index + 1} of ${dialog.count}: ${result.error}`,
                        color: COLORS.failed,
                      },
                    ]
              }
              width={width}
            />
          ))}
          {dialog.phase === "running" ? (
            <Busy
              message={`Adding spool ${Math.min(dialog.results.length + 1, dialog.count)} of ${dialog.count}…`}
            />
          ) : dialog.error ? (
            <Line
              segments={[{ text: `✗ Nothing added: ${dialog.error}`, color: COLORS.failed }]}
              width={width}
            />
          ) : (
            <>
              {blank(width)}
              <Line
                segments={[
                  {
                    text: `Done: ${created} added${failed ? `, ${failed} failed` : ""}`,
                    color: failed ? COLORS.failed : COLORS.ok,
                    bold: true,
                  },
                ]}
                width={width}
              />
            </>
          )}
        </>
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
      <Line
        segments={[{ text: "Scan the spool's barcode, or type it and press enter." }]}
        width={width}
      />
      {blank(width)}
      <Box flexDirection="row">
        <Line segments={[{ text: "Barcode  ", color: COLORS.muted }]} width={9} />
        <TextField
          value={dialog.text.value}
          cursor={dialog.text.cursor}
          focused
          placeholder="scan now"
          width={width - 9}
        />
      </Box>
      {dialog.error ? (
        <Line segments={[{ text: dialog.error, color: COLORS.failed }]} width={width} />
      ) : (
        blank(width)
      )}
      {blank(width)}
      {dialog.pending ? (
        <Busy message={`Looking up ${dialog.pending}…`} />
      ) : (
        <Line
          segments={[
            {
              text:
                model.barcodes === null
                  ? "Reading the barcodes bambu-hando knows…"
                  : known > 0
                    ? `${known} known so far; a new one asks which filament it is, once.`
                    : "A new barcode asks which filament it is, once.",
              color: COLORS.muted,
            },
          ]}
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
    filamentRow(dialog.filament, `More spools of ${dialog.filament.name}`),
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
      <Line
        segments={[
          { text: "You told bambu-hando this barcode is ", color: COLORS.muted },
          { text: dialog.filament.name, bold: true },
        ]}
        width={width}
      />
      {blank(width)}
      <List rows={rows} cursor={dialog.cursor} height={2} width={width} />
    </>
  );
}

function ChooseBody({
  dialog,
  width,
  listHeight,
}: {
  dialog: ChooseDialog;
  width: number;
  listHeight: number;
}) {
  return (
    <>
      <Line
        segments={[
          {
            text: dialog.gone
              ? `It was ${dialog.gone.name}, which no spool on the console is now.`
              : "A new barcode: which filament is it? Asked once, then remembered.",
            color: COLORS.muted,
          },
        ]}
        width={width}
      />
      {blank(width)}
      {dialog.saving ? (
        <Busy message={`Remembering barcode ${dialog.barcode}…`} />
      ) : (
        <List
          rows={dialog.filaments.map((f) => filamentRow(f))}
          cursor={dialog.cursor}
          height={Math.max(1, Math.min(dialog.filaments.length, listHeight))}
          width={width}
        />
      )}
    </>
  );
}

function title(dialog: SpoolsDialogState): string {
  switch (dialog.kind) {
    case "count":
      return dialog.phase === "choose"
        ? "More spools like this one"
        : `Adding ${plural(dialog.count, "spool")}`;
    case "scan":
      return "Scan a barcode";
    case "known":
      return `Barcode ${dialog.barcode}`;
    case "choose":
      return `Which filament is ${dialog.barcode}?`;
  }
}

/** Dialog rows other than the content: borders, padding and the key line. */
const DIALOG_CHROME = 6;

export function SpoolsDialog({
  dialog,
  model,
  ctx,
}: {
  dialog: SpoolsDialogState;
  model: SpoolsModel;
  ctx: Ctx;
}) {
  const width = Math.min(DIALOG_WIDTH + 8, Math.max(20, ctx.bodyColumns - 4));
  const inner = dialogInner(width);
  let body: ReactNode;
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
    case "choose":
      body = (
        <ChooseBody
          dialog={dialog}
          width={inner}
          listHeight={ctx.bodyRows - DIALOG_CHROME - 2 - 2}
        />
      );
      break;
  }
  return (
    <Dialog title={title(dialog)} width={width} hints={dialogHints(dialog)}>
      {body}
    </Dialog>
  );
}
