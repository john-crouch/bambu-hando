// ABOUTME: The header line: the gradient app name, the tabs as pills (the active one filled in accent), the console's state.
// ABOUTME: headerLayout picks the fullest form that fits: the printer, then the console text, then the name give way first.

import { useSpinner } from "@inkjs/ui";
import { Text } from "ink";
import Gradient from "ink-gradient";

import { Segments } from "./Line.js";
import { APP_NAME } from "./Title.js";
import { fitSegments, type Segment, segmentsWidth, spaces, textWidth } from "./text.js";
import { COLORS, GRADIENT, ICONS } from "./theme.js";

export interface HeaderTab {
  id: string;
  title: string;
  badge?: string | number;
}

export type ConsoleState = "ok" | "failed" | "checking" | "skipped";

export interface HeaderStatus {
  console: ConsoleState;
  consoleText: string;
  printerText: string;
}

export interface HeaderProps {
  tabs: readonly HeaderTab[];
  active: string;
  status: HeaderStatus;
  columns: number;
}

/** How much of the header is shown at a width; see headerLayout. */
export interface HeaderLayout {
  name: boolean;
  /** Inactive tabs keep their padding (pills side by side) or lose it (compact). */
  compact: boolean;
  status: "full" | "console" | "icon" | "none";
}

/** The name block, " bambu-hando  ", or a one-space margin without it. */
function leadWidth(name: boolean): number {
  return name ? textWidth(` ${APP_NAME}  `) : 1;
}

function showBadge(badge: string | number | undefined): badge is string | number {
  return badge !== undefined && badge !== "" && badge !== 0;
}

/** The tabs as segments: the active one a filled pill, the others muted, badges in warning. */
export function tabSegments(
  tabs: readonly HeaderTab[],
  active: string,
  compact: boolean,
): Segment[] {
  return tabs.flatMap((tab, index) => {
    const on = tab.id === active;
    const pad = on || !compact ? " " : "";
    const pill = on
      ? { backgroundColor: COLORS.accent, color: COLORS.selectionText, bold: true }
      : {};
    const gap: Segment[] =
      compact && index > 0 && !on && tabs[index - 1]?.id !== active ? [{ text: " " }] : [];
    return [
      ...gap,
      { text: `${pad}${tab.title}`, ...(on ? pill : { color: COLORS.muted }) },
      ...(showBadge(tab.badge)
        ? [{ text: ` ${tab.badge}`, ...(on ? pill : { color: COLORS.warning, bold: true }) }]
        : []),
      ...(pad ? [{ text: pad, ...(on ? pill : {}) }] : []),
    ];
  });
}

const STATUS_ICON: Record<Exclude<ConsoleState, "checking">, Segment> = {
  ok: { text: ICONS.ok, color: COLORS.ok, bold: true },
  failed: { text: ICONS.failed, color: COLORS.failed, bold: true },
  skipped: { text: ICONS.skipped, color: COLORS.muted },
};

/** The status after its icon (the icon is drawn separately, since the spinner turns). */
function statusText(status: HeaderStatus, form: HeaderLayout["status"]): Segment[] {
  if (form === "icon" || form === "none") return [];
  const consoleText = { text: ` ${status.consoleText}` };
  const printer: Segment[] =
    form === "full" && status.printerText
      ? [
          { text: " · ", color: COLORS.muted },
          { text: status.printerText, color: COLORS.muted },
        ]
      : [];
  return [consoleText, ...printer];
}

/** Columns the status takes in a form, icon and the one-space right margin included. */
function statusWidth(status: HeaderStatus, form: HeaderLayout["status"]): number {
  return form === "none" ? 0 : 1 + segmentsWidth(statusText(status, form)) + 1;
}

/** The fullest header that fits: drops the printer, then the console text, then the name, then tab padding. */
export function headerLayout(
  tabs: readonly HeaderTab[],
  active: string,
  status: HeaderStatus,
  columns: number,
): HeaderLayout {
  const forms: HeaderLayout[] = [];
  for (const form of ["full", "console", "icon"] as const)
    forms.push({ name: true, compact: false, status: form });
  forms.push({ name: true, compact: true, status: "icon" });
  forms.push({ name: false, compact: true, status: "icon" });
  forms.push({ name: false, compact: true, status: "none" });
  for (const layout of forms) {
    const width =
      leadWidth(layout.name) +
      segmentsWidth(tabSegments(tabs, active, layout.compact)) +
      // At least one space before the status.
      (layout.status === "none" ? 0 : 1 + statusWidth(status, layout.status));
    if (width <= columns) return layout;
  }
  return { name: false, compact: true, status: "none" };
}

function Spinning() {
  const { frame } = useSpinner({ type: "dots" });
  return <Text color={COLORS.accent}>{frame}</Text>;
}

export function Header({ tabs, active, status, columns }: HeaderProps) {
  if (columns <= 0) return null;
  const layout = headerLayout(tabs, active, status, columns);
  const lead = leadWidth(layout.name);
  const tabs_ = tabSegments(tabs, active, layout.compact);
  const tabsRoom = Math.max(0, columns - lead);
  // Cut tabs only when even the smallest form doesn't fit.
  const shownTabs = segmentsWidth(tabs_) > tabsRoom ? fitSegments(tabs_, tabsRoom) : tabs_;
  const right = layout.status === "none" ? [] : statusText(status, layout.status);
  const statusCols = layout.status === "none" ? 0 : 1 + segmentsWidth(right) + 1;
  const gap = columns - lead - segmentsWidth(shownTabs) - statusCols;
  return (
    <Text wrap="truncate-end">
      {layout.name ? (
        <Text bold>
          {" "}
          <Gradient colors={GRADIENT}>{APP_NAME}</Gradient>
          {"  "}
        </Text>
      ) : (
        " "
      )}
      <Segments segments={shownTabs} />
      {spaces(gap)}
      {layout.status === "none" ? null : (
        <>
          {status.console === "checking" ? (
            <Spinning />
          ) : (
            <Segments segments={[STATUS_ICON[status.console]]} />
          )}
          <Segments segments={right} />{" "}
        </>
      )}
    </Text>
  );
}
