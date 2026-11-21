// ABOUTME: A rounded, bordered panel with its title and subtitle set into the top border and a note in the bottom one.
// ABOUTME: Dim when it isn't focused, accent when it is; children get the inside, panelInner says how big that is.

import { Box, Text } from "ink";
import type { ReactNode } from "react";

import { Line } from "./Line.js";
import { type Segment, textWidth, truncate } from "./text.js";
import { COLORS } from "./theme.js";

/** The inside of a panel of this size: one column and one row of border on each side. */
export function panelInner(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(0, width - 2), height: Math.max(0, height - 2) };
}

/** `╭ Title · subtitle ──────╮` in exactly width columns: the subtitle is cut first, then the title. */
export function panelTop(
  width: number,
  title: string,
  subtitle: string | undefined,
  focused: boolean,
): Segment[] {
  const border = focused ? COLORS.accent : COLORS.border;
  const inner = width - 2;
  if (inner < 0) return [];
  // " Title · sub " needs a space each side and leaves at least one ─ before ╮.
  const room = inner - 3;
  const label: Segment[] = [];
  if (title && room > 0) {
    const shownTitle = truncate(title, room);
    label.push({ text: shownTitle, color: focused ? COLORS.accent : COLORS.muted, bold: focused });
    const left = room - textWidth(shownTitle) - 3;
    // A subtitle cut to one or two columns says nothing: drop it instead.
    if (subtitle && left >= 3) {
      label.push({ text: " · ", color: COLORS.muted });
      label.push({ text: truncate(subtitle, left), color: COLORS.muted });
    }
  }
  const labelWidth = label.reduce((sum, segment) => sum + textWidth(segment.text), 0);
  const dashes = label.length > 0 ? inner - labelWidth - 2 : inner;
  return [
    { text: "╭", color: border },
    ...(label.length > 0 ? [{ text: " " }, ...label, { text: " " }] : []),
    { text: "─".repeat(dashes), color: border },
    { text: "╮", color: border },
  ];
}

/** `╰──────── 3/14 ─╯` in exactly width columns. */
export function panelBottom(width: number, note: string | undefined, focused: boolean): Segment[] {
  const border = focused ? COLORS.accent : COLORS.border;
  const inner = width - 2;
  if (inner < 0) return [];
  const room = inner - 3;
  const shown = note && room > 0 ? truncate(note, room) : "";
  const tail: Segment[] = shown
    ? [
        { text: " " },
        { text: shown, color: COLORS.muted },
        { text: " " },
        { text: "─", color: border },
      ]
    : [];
  const dashes = shown ? inner - textWidth(shown) - 3 : inner;
  return [
    { text: "╰", color: border },
    { text: "─".repeat(dashes), color: border },
    ...tail,
    { text: "╯", color: border },
  ];
}

export interface PanelProps {
  title: string;
  subtitle?: string;
  focused?: boolean;
  /** Columns, borders included. Without it the panel grows to its share of the row and its title isn't cut. */
  width?: number;
  /** Rows, borders included. */
  height?: number;
  grow?: boolean;
  /** A short note set into the bottom border's right end, e.g. the list position "12/41". */
  footerRight?: string;
  children?: ReactNode;
}

/** A top or bottom border without a known width: the dashes fill whatever the row gives the panel. */
function FlexBorder({
  left,
  label,
  right,
  color,
}: {
  left: string;
  label: Segment[];
  right: string;
  color: string;
}) {
  return (
    <Box height={1} flexShrink={0}>
      <Text color={color}>{left}</Text>
      {label.map((segment, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed sequence per render.
        <Text key={index} {...segment} wrap="truncate-end">
          {segment.text}
        </Text>
      ))}
      <Box flexGrow={1} height={1} overflow="hidden">
        <Text color={color}>{"─".repeat(1000)}</Text>
      </Box>
      <Text color={color}>{right}</Text>
    </Box>
  );
}

export function Panel({
  title,
  subtitle,
  focused = false,
  width,
  height,
  grow,
  footerRight,
  children,
}: PanelProps) {
  const border = focused ? COLORS.accent : COLORS.border;
  const middle = height === undefined ? undefined : Math.max(0, height - 2);
  const flex = grow ? { flexGrow: 1, flexBasis: 0 } : {};
  if (width !== undefined && width < 2) return null;

  const top =
    width === undefined ? (
      <FlexBorder
        left="╭"
        label={
          title
            ? [
                { text: " " },
                { text: title, color: focused ? COLORS.accent : COLORS.muted, bold: focused },
                ...(subtitle ? [{ text: ` · ${subtitle}`, color: COLORS.muted }] : []),
                { text: " " },
              ]
            : []
        }
        right="╮"
        color={border}
      />
    ) : (
      <Line segments={panelTop(width, title, subtitle, focused)} width={width} />
    );
  const bottom =
    width === undefined ? (
      <FlexBorder
        left="╰"
        label={[]}
        right={footerRight ? ` ${footerRight} ─╯` : "╯"}
        color={border}
      />
    ) : (
      <Line segments={panelBottom(width, footerRight, focused)} width={width} />
    );

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      {...(width === undefined ? {} : { width })}
      {...(height === undefined ? {} : { height })}
      {...flex}
    >
      {top}
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom={false}
        borderColor={border}
        flexDirection="column"
        overflow="hidden"
        flexShrink={0}
        {...(middle === undefined ? { flexGrow: 1 } : { height: middle })}
      >
        {children}
      </Box>
      {bottom}
    </Box>
  );
}
