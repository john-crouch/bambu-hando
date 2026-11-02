// ABOUTME: TUI settings: import file, BambuStudio folder and printers (chosen from lists), and the SpoolEase connection.
// ABOUTME: Arrow/tab keys move focus, enter or space changes the focused row, esc returns to the menu; the key is masked.

import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import type { FormValues } from "./App.js";

type TextKey = "source" | "host" | "port" | "securityKey";
export type ChoiceKey = "presetFolder" | "printerPreset";
type ToggleKey = "overwritePresets" | "https" | "skipSpoolease" | "createSpools";

type Field =
  | { key: TextKey; label: string; kind: "text" | "secret"; spoolease: boolean }
  | { key: ChoiceKey; label: string; kind: "choice"; spoolease: boolean }
  | { key: ToggleKey; label: string; kind: "toggle"; spoolease: boolean };

export const FIELDS: Field[] = [
  { key: "source", label: "Import file or URL", kind: "text", spoolease: false },
  { key: "presetFolder", label: "Preset folder", kind: "choice", spoolease: false },
  { key: "printerPreset", label: "Printer preset(s)", kind: "choice", spoolease: false },
  { key: "overwritePresets", label: "Overwrite presets", kind: "toggle", spoolease: false },
  { key: "host", label: "SpoolEase host", kind: "text", spoolease: true },
  { key: "port", label: "SpoolEase port", kind: "text", spoolease: true },
  { key: "securityKey", label: "Security key", kind: "secret", spoolease: true },
  { key: "https", label: "Use HTTPS", kind: "toggle", spoolease: true },
  { key: "skipSpoolease", label: "Skip SpoolEase", kind: "toggle", spoolease: false },
  { key: "createSpools", label: "Create spools", kind: "toggle", spoolease: true },
];

// Focus marker, the longest label, and a gap before the value.
const LABEL_WIDTH = 2 + Math.max(...FIELDS.map((f) => f.label.length)) + 2;

interface Props {
  values: FormValues;
  error: string;
  /** Index into FIELDS; kept by App so returning from a list lands on the same row. */
  focus: number;
  onFocus: (focus: number) => void;
  onChange: (values: FormValues) => void;
  /** Open the list for a choice row. */
  onChoose: (key: ChoiceKey) => void;
  onBack: () => void;
}

export function SetupForm({ values, error, focus, onFocus, onChange, onChoose, onBack }: Props) {
  const focused = FIELDS[focus];
  const down = (): void => onFocus((focus + 1) % FIELDS.length);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow || (key.tab && key.shift)) {
      onFocus((focus + FIELDS.length - 1) % FIELDS.length);
    } else if (key.downArrow || key.tab) {
      down();
    } else if (focused?.kind === "toggle" && (input === " " || key.return)) {
      onChange({ ...values, [focused.key]: !values[focused.key] });
    } else if (focused?.kind === "choice" && (input === " " || key.return)) {
      onChoose(focused.key);
    }
    // Enter in a text field moves on, through TextInput's onSubmit.
  });

  return (
    <Box flexDirection="column">
      <Text bold>bambu-hando: sync filament profiles to BambuStudio and SpoolEase</Text>
      <Box flexDirection="column" marginY={1}>
        {FIELDS.map((field, index) => {
          const isFocused = index === focus;
          const dimmed = field.spoolease && values.skipSpoolease;
          return (
            <Box key={field.key}>
              <Box width={LABEL_WIDTH}>
                <Text color={isFocused ? "cyan" : undefined} dimColor={dimmed}>
                  {isFocused ? "› " : "  "}
                  {field.label}
                </Text>
              </Box>
              {field.kind === "toggle" ? (
                <Text dimColor={dimmed}>{values[field.key] ? "[x]" : "[ ]"}</Text>
              ) : field.kind === "choice" ? (
                <Text color={isFocused ? "cyan" : undefined}>{values[field.key]}</Text>
              ) : (
                <TextInput
                  value={values[field.key]}
                  focus={isFocused}
                  mask={field.kind === "secret" ? "*" : undefined}
                  onChange={(value) => onChange({ ...values, [field.key]: value })}
                  onSubmit={down}
                />
              )}
            </Box>
          );
        })}
      </Box>
      <Text dimColor>A JSON file or URL of filament profiles shows up as Import on the menu. Folder and printers open a list.</Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>↑/↓ move · enter change · esc menu · ctrl+c quit</Text>
    </Box>
  );
}
