// ABOUTME: Per-brand empty spool weight menu: SpoolEase catalog rows, or the source's weight vs unspecified.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { Box, type Key, Text } from "ink";

import type { FilamentProfile } from "../models.js";
import { describeSourceWeights, type WeightChoice, type WeightGroup } from "../spoolWeights.js";
import { visibleRange } from "./Picker.js";

const ROWS = 12;
const LABEL_WIDTH = 52;

export interface WeightItem {
  label: string;
  detail: string;
  choice: WeightChoice;
}

export type WeightAction = { type: "move"; cursor: number } | { type: "choose" } | { type: "back" } | { type: "none" };

/** The brand's catalog rows; a brand the catalog doesn't list chooses between the source's weight and unspecified. */
export function weightItems(group: WeightGroup, profiles: FilamentProfile[], sourceName: string): WeightItem[] {
  if (group.options.length > 0) {
    return group.options.map((option) => ({
      label: option.label,
      detail: `${option.grams} g${option.mine ? " · My Spools List" : ""}`,
      choice: { kind: "grams", grams: option.grams },
    }));
  }
  return [
    { label: sourceName, detail: describeSourceWeights(profiles, group), choice: { kind: "source" } },
    { label: "Unspecified", detail: "SpoolEase works it out when the full spool is first weighed", choice: { kind: "unspecified" } },
  ];
}

/** The item matching an earlier choice, so going back shows what was picked. */
export function itemIndex(items: WeightItem[], choice: WeightChoice | undefined): number {
  if (!choice) return 0;
  const index = items.findIndex((item) => JSON.stringify(item.choice) === JSON.stringify(choice));
  return Math.max(0, index);
}

export function weightInput(cursor: number, key: Key, count: number): WeightAction {
  const last = Math.max(0, count - 1);
  if (key.escape) return { type: "back" };
  if (key.return) return { type: "choose" };
  if (key.upArrow) return { type: "move", cursor: Math.max(0, cursor - 1) };
  if (key.downArrow) return { type: "move", cursor: Math.min(last, cursor + 1) };
  return { type: "none" };
}

interface Props {
  group: WeightGroup;
  profiles: FilamentProfile[];
  items: WeightItem[];
  cursor: number;
  step: number;
  steps: number;
  sourceName: string;
  warnings: string[];
}

export function WeightMenu({ group, profiles, items, cursor, step, steps, sourceName, warnings }: Props) {
  const [start, end] = visibleRange(cursor, items.length, ROWS);
  const names = group.profiles.map((i) => profiles[i]?.name ?? "");
  const count = names.length;

  return (
    <Box flexDirection="column">
      <Text bold>
        Empty spool weight: {group.brand || "(no brand)"} · brand {step + 1} of {steps}
      </Text>
      <Text wrap="truncate-end" dimColor>
        {count} filament{count === 1 ? "" : "s"}: {names.join(", ")}
      </Text>
      {group.options.length > 0 ? (
        <Text dimColor>
          SpoolEase's spool catalog lists several; {sourceName} says {describeSourceWeights(profiles, group)}
        </Text>
      ) : (
        <Text dimColor>Not in SpoolEase's spool catalog</Text>
      )}
      {warnings.map((w) => (
        <Text key={w} color="yellow">
          ! {w}
        </Text>
      ))}
      <Box flexDirection="column" marginY={1}>
        {items.slice(start, end).map((item, offset) => {
          const active = start + offset === cursor;
          return (
            <Box key={item.label}>
              <Box width={2}>
                <Text>{active ? "›" : ""}</Text>
              </Box>
              <Box width={LABEL_WIDTH}>
                <Text wrap="truncate-end" color={active ? "cyan" : undefined}>
                  {item.label}
                </Text>
              </Box>
              <Text dimColor>{item.detail}</Text>
            </Box>
          );
        })}
        {items.length > end ? <Text dimColor>… {items.length - end} more</Text> : null}
      </Box>
      <Text dimColor>↑/↓ move · enter choose · esc back</Text>
    </Box>
  );
}
