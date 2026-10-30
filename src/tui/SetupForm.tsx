// ABOUTME: TUI setup form for source, BambuStudio, and SpoolEase connection settings.
// ABOUTME: Arrow/tab keys move focus, space toggles switches, enter submits; the key is masked.

import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";

import type { FormValues } from "./App.js";

type TextKey = "source" | "presetFolder" | "printerPreset" | "host" | "port" | "securityKey";
type ToggleKey = "https" | "skipSpoolease" | "createSpools";

type Field =
  | { key: TextKey; label: string; kind: "text" | "secret"; spoolease: boolean }
  | { key: ToggleKey; label: string; kind: "toggle"; spoolease: boolean };

const FIELDS: Field[] = [
  { key: "source", label: "Source (file or URL)", kind: "text", spoolease: false },
  { key: "presetFolder", label: "Preset folder", kind: "text", spoolease: false },
  { key: "printerPreset", label: "Printer preset", kind: "text", spoolease: false },
  { key: "host", label: "SpoolEase host", kind: "text", spoolease: true },
  { key: "port", label: "SpoolEase port", kind: "text", spoolease: true },
  { key: "securityKey", label: "Security key", kind: "secret", spoolease: true },
  { key: "https", label: "Use HTTPS", kind: "toggle", spoolease: true },
  { key: "skipSpoolease", label: "Skip SpoolEase", kind: "toggle", spoolease: false },
  { key: "createSpools", label: "Create spools", kind: "toggle", spoolease: true },
];

const LABEL_WIDTH = 22;

interface Props {
  values: FormValues;
  error: string;
  onChange: (values: FormValues) => void;
  onSubmit: () => void;
}

export function SetupForm({ values, error, onChange, onSubmit }: Props) {
  const [focus, setFocus] = useState(0);
  const focused = FIELDS[focus];

  useInput((input, key) => {
    if (key.upArrow || (key.tab && key.shift)) {
      setFocus((f) => (f + FIELDS.length - 1) % FIELDS.length);
    } else if (key.downArrow || key.tab) {
      setFocus((f) => (f + 1) % FIELDS.length);
    } else if (focused?.kind === "toggle" && input === " ") {
      onChange({ ...values, [focused.key]: !values[focused.key] });
    } else if (focused?.kind === "toggle" && key.return) {
      // Text fields submit through TextInput's own onSubmit.
      onSubmit();
    }
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
              ) : (
                <TextInput
                  value={values[field.key]}
                  focus={isFocused}
                  mask={field.kind === "secret" ? "*" : undefined}
                  onChange={(value) => onChange({ ...values, [field.key]: value })}
                  onSubmit={onSubmit}
                />
              )}
            </Box>
          );
        })}
      </Box>
      <Text dimColor>Source can be a JSON file or URL, or spoolmandb to search the SpoolmanDB filament database.</Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>↑/↓ move · space toggle · enter load plan · ctrl+c quit</Text>
    </Box>
  );
}
