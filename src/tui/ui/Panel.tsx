// ABOUTME: A rounded, bordered panel with its title and subtitle set into the top border and a note in the bottom one.
// ABOUTME: Dim when it isn't focused, accent when it is; children get the inside, panelInner says how big that is.

import { Box, Text } from "ink";
import { type ReactNode, useContext } from "react";

import { Backdrop } from "./backdrop.js";
import { Line, Segments } from "./Line.js";
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
  /**
   * Columns, borders included. Without it the panel takes its share of the row (grow) and Ink draws the
   * border; pass widths from splitWidths for exact side-by-side panels.
   */
  width?: number;
  /** Rows, borders included. */
  height?: number;
  grow?: boolean;
  /** A short note set into the bottom border's right end, e.g. the list position "12/41". */
  footerRight?: string;
  children?: ReactNode;
}

/**
 * Whole-column widths for panels side by side in `total` columns, in proportion to `weights`; the
 * columns rounding leaves go to the first panels. Pass these as widths: a flex split of an odd width
 * makes Yoga round a column off one border.
 */
export function splitWidths(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length, left--) out[i] = (out[i] ?? 0) + 1;
  return out;
}

/** The panel without a width: Ink draws the border, the title and note are set over it. */
function FlexPanel({
  title,
  subtitle,
  focused,
  height,
  grow,
  footerRight,
  children,
}: Omit<PanelProps, "width">) {
  const backdrop = useContext(Backdrop);
  const border = focused && !backdrop ? COLORS.accent : COLORS.border;
  return (
    <Box
      borderStyle="round"
      borderColor={border}
      borderDimColor={backdrop}
      flexDirection="column"
      {...(height === undefined ? {} : { height })}
      {...(grow ? { flexGrow: 1, flexBasis: 0 } : {})}
    >
      {title ? (
        // left 0 and right 1: the label never covers the last ─ before ╮.
        <Box position="absolute" top={-1} left={0} right={1} height={1} overflow="hidden">
          <Text wrap="truncate-end">
            <Segments
              segments={[
                { text: " " },
                { text: title, color: focused ? COLORS.accent : COLORS.muted, bold: !!focused },
                ...(subtitle ? [{ text: ` · ${subtitle}`, color: COLORS.muted }] : []),
                { text: " " },
              ]}
            />
          </Text>
        </Box>
      ) : null}
      {footerRight ? (
        <Box
          position="absolute"
          bottom={-1}
          left={0}
          right={0}
          height={1}
          justifyContent="flex-end"
        >
          <Box marginRight={1} flexShrink={0}>
            <Text color={COLORS.muted} dimColor={backdrop}>
              {" "}
              {footerRight}{" "}
            </Text>
          </Box>
        </Box>
      ) : null}
      {/* Clipped here, not on the bordered box, which would clip the title and note on its border. */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <Box flexDirection="column" flexShrink={0}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

export function Panel(props: PanelProps) {
  const { focused = false, width } = props;
  if (width === undefined) return <FlexPanel {...props} />;
  if (width < 2) return null;
  return <FixedPanel {...props} width={width} focused={focused} />;
}

function FixedPanel({
  title,
  subtitle,
  focused,
  width,
  height,
  footerRight,
  children,
}: PanelProps & { width: number; focused: boolean }) {
  const backdrop = useContext(Backdrop);
  const border = focused && !backdrop ? COLORS.accent : COLORS.border;
  const middle = height === undefined ? undefined : Math.max(0, height - 2);
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={width}
      {...(height === undefined ? {} : { height })}
    >
      <Line segments={panelTop(width, title, subtitle, focused)} width={width} />
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom={false}
        borderColor={border}
        borderDimColor={backdrop}
        flexDirection="column"
        overflow="hidden"
        flexShrink={0}
        {...(middle === undefined ? { flexGrow: 1 } : { height: middle })}
      >
        {/* Children keep their own heights; the panel clips what doesn't fit instead of squashing it. */}
        <Box flexDirection="column" flexShrink={0}>
          {children}
        </Box>
      </Box>
      <Line segments={panelBottom(width, footerRight, focused)} width={width} />
    </Box>
  );
}
