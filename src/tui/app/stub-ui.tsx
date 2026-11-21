// ABOUTME: Private stand-ins for the design system (src/tui/ui/) with its names and props, so the shell runs before it lands.
// ABOUTME: At integration the shell's imports switch from ./stub-ui.js to ../ui/; nothing else imports this file.

import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import type { ReactElement, ReactNode } from "react";
import stringWidth from "string-width";

import { theme as oldTheme } from "../theme.js";

export const COLORS = {
  accent: "#A06BFF",
  accent2: "#FF5F87",
  ok: "green",
  warning: "yellow",
  failed: "red",
  muted: "gray",
  selection: "#3B2F5C",
  selectionText: "whiteBright",
  border: "gray",
} as const;

export const GRADIENT = [COLORS.accent2, COLORS.accent];

export const theme = oldTheme;

export interface Hint {
  keys: string;
  label: string;
  primary?: boolean;
}

/** text cut to width columns, ending in … when cut. */
function cut(text: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(text) <= width) return text;
  let out = "";
  for (const char of text) {
    if (stringWidth(`${out}${char}`) > width - 1) break;
    out += char;
  }
  return `${out}…`;
}

export function Frame({
  columns,
  rows,
  header,
  footer,
  overlay,
  children,
}: {
  columns: number;
  rows: number;
  header: ReactNode;
  footer: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box height={1} flexShrink={0}>
        {header}
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {children}
        {overlay ? (
          <Box
            position="absolute"
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            {overlay}
          </Box>
        ) : null}
      </Box>
      <Box height={1} flexShrink={0}>
        {footer}
      </Box>
    </Box>
  );
}

export interface HeaderStatus {
  console: "ok" | "failed" | "checking" | "skipped";
  consoleText: string;
  printerText: string;
}

const STATUS_MARK: Record<Exclude<HeaderStatus["console"], "checking">, [string, string]> = {
  ok: ["✓", COLORS.ok],
  failed: ["✗", COLORS.failed],
  skipped: ["-", COLORS.muted],
};

export function Header({
  tabs,
  active,
  status,
  columns,
}: {
  tabs: { id: string; title: string; badge?: string }[];
  active: string;
  status: HeaderStatus;
  columns: number;
}): ReactElement {
  const name = " bambu-hando ";
  const pills = tabs.map((tab) => ({
    ...tab,
    text: ` ${tab.title}${tab.badge ? ` ${tab.badge}` : ""} `,
  }));
  const used = stringWidth(name) + 1 + pills.reduce((sum, p) => sum + stringWidth(p.text), 0);
  const room = columns - used - 2;
  const full = [status.consoleText, status.printerText].filter(Boolean).join(" · ");
  const right = room >= stringWidth(full) + 2 ? full : cut(status.consoleText, room - 2);
  const mark =
    status.console === "checking" ? null : (
      <Text color={STATUS_MARK[status.console][1]}>{STATUS_MARK[status.console][0]} </Text>
    );
  return (
    <Box width={columns}>
      <Box flexShrink={0}>
        <Text bold>
          <Gradient colors={GRADIENT}>{name}</Gradient>
        </Text>
        <Text> </Text>
        {pills.map((pill) =>
          pill.id === active ? (
            <Text key={pill.id} backgroundColor={COLORS.accent} color="black" bold>
              {pill.text}
            </Text>
          ) : (
            <Text key={pill.id} dimColor>
              {pill.text}
            </Text>
          ),
        )}
      </Box>
      <Box flexGrow={1} justifyContent="flex-end" paddingRight={1}>
        {room >= 4 ? (
          <>
            {status.console === "checking" ? <Spinner type="dots" label="" /> : mark}
            <Text dimColor wrap="truncate-end">
              {status.console === "checking" ? ` ${right}` : right}
            </Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
}

export function Footer({
  hints,
  columns,
  toast,
}: {
  hints: Hint[];
  columns: number;
  toast?: { text: string; tone?: "ok" | "warning" | "failed" };
}): ReactElement {
  const toastText = toast ? `${toast.text} ` : "";
  const room = columns - 1 - stringWidth(toastText) - (toast ? 2 : 0);
  const fits = (list: Hint[]) =>
    list.reduce((sum, h) => sum + stringWidth(h.keys) + 1 + stringWidth(h.label) + 2, 0) <= room;
  let shown = hints;
  if (!fits(shown)) shown = hints.filter((h) => h.primary);
  while (shown.length > 0 && !fits(shown)) shown = shown.slice(0, -1);
  return (
    <Box width={columns}>
      <Box flexGrow={1} paddingLeft={1}>
        {shown.map((hint, index) => (
          <Text key={`${hint.keys}-${hint.label}`}>
            {index > 0 ? "  " : ""}
            <Text color={COLORS.accent2}>{hint.keys}</Text> <Text dimColor>{hint.label}</Text>
          </Text>
        ))}
      </Box>
      {toast ? (
        <Box flexShrink={0}>
          <Text color={toast.tone ? COLORS[toast.tone] : COLORS.accent}>{toastText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** A centered bordered box in accent with its own key line; blank cells cover what's beneath it. */
export function Dialog({
  title,
  width = 60,
  children,
  hints,
}: {
  title: string;
  width?: number;
  children: ReactNode;
  hints: Hint[];
}): ReactElement {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={COLORS.accent}
      backgroundColor="#16131F"
      paddingX={1}
    >
      <Text bold color={COLORS.accent}>
        {cut(title, width - 4)}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
      <Box marginTop={1}>
        <Footer hints={hints} columns={width - 4} />
      </Box>
    </Box>
  );
}

export function Empty({
  title,
  lines,
  action,
}: {
  title: string;
  lines: string[];
  action?: Hint;
}): ReactElement {
  return (
    <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      <Text bold>{title}</Text>
      {lines.map((line) => (
        <Text key={line} dimColor>
          {line}
        </Text>
      ))}
      {action ? (
        <Box marginTop={1}>
          <Text color={COLORS.accent2}>{action.keys}</Text>
          <Text dimColor> {action.label}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function Busy({ message }: { message: string }): ReactElement {
  return <Spinner type="dots" label={message} />;
}
