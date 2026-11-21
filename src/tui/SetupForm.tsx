// ABOUTME: TUI settings: import file, BambuStudio folder and printers (chosen from lists), and the SpoolEase connection.
// ABOUTME: Arrow/tab keys move focus, enter or space changes the focused row, esc returns to the menu; the key is masked.

import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import type { FormValues } from "./App.js";

type TextKey = "source" | "host" | "port" | "securityKey";
export type ChoiceKey = "presetFolder" | "printerPreset";
type ToggleKey = "overwritePresets" | "https" | "skipSpoolease" | "createSpools";

/** spoolease: dimmed when SpoolEase is skipped; inConnection: shown only while the SpoolEase console row is open. */
type Field = { spoolease: boolean; inConnection?: boolean } & (
  | { key: TextKey; label: string; kind: "text" | "secret" }
  | { key: ChoiceKey; label: string; kind: "choice" }
  | { key: ToggleKey; label: string; kind: "toggle" }
  | { key: "connection"; label: string; kind: "section" }
);

const FIELDS: Field[] = [
  { key: "source", label: "Import file or URL", kind: "text", spoolease: false },
  { key: "presetFolder", label: "Preset folder", kind: "choice", spoolease: false },
  { key: "printerPreset", label: "Printer preset(s)", kind: "choice", spoolease: false },
  { key: "overwritePresets", label: "Overwrite presets", kind: "toggle", spoolease: false },
  { key: "skipSpoolease", label: "Skip SpoolEase", kind: "toggle", spoolease: false },
  { key: "createSpools", label: "Create spools", kind: "toggle", spoolease: true },
  { key: "connection", label: "SpoolEase console", kind: "section", spoolease: true },
  { key: "host", label: "  Host", kind: "text", spoolease: true, inConnection: true },
  { key: "port", label: "  Port", kind: "text", spoolease: true, inConnection: true },
  {
    key: "securityKey",
    label: "  Security key",
    kind: "secret",
    spoolease: true,
    inConnection: true,
  },
  { key: "https", label: "  Use HTTPS", kind: "toggle", spoolease: true, inConnection: true },
];

/** The connection's own rows are open on request, and always while the host or key is missing. */
export function connectionOpen(values: FormValues, requested: boolean): boolean {
  return requested || !values.host.trim() || !values.securityKey;
}

/** Whether the focused row is a text field, where ? is typed rather than opening help. */
export function formTyping(connection: boolean, focus: number): boolean {
  const kind = FIELDS.filter((field) => connection || !field.inConnection)[focus]?.kind;
  return kind === "text" || kind === "secret";
}

function connectionSummary(values: FormValues): string {
  return `${values.host.trim() || "no host"}:${values.port}${values.https ? " (HTTPS)" : ""}`;
}

// Focus marker, the longest label, and a gap before the value.
const LABEL_WIDTH = 2 + Math.max(...FIELDS.map((f) => f.label.length)) + 2;

interface Props {
  values: FormValues;
  error: string;
  /** Index into the visible rows; kept by App so returning from a list lands on the same row. */
  focus: number;
  onFocus: (focus: number) => void;
  /** Whether the SpoolEase console row shows its host, port, key and HTTPS rows. */
  connection: boolean;
  onConnection: () => void;
  onChange: (values: FormValues) => void;
  /** Open the list for a choice row. */
  onChoose: (key: ChoiceKey) => void;
  onBack: () => void;
}

export function SetupForm({
  values,
  error,
  focus,
  onFocus,
  connection,
  onConnection,
  onChange,
  onChoose,
  onBack,
}: Props) {
  const fields = FIELDS.filter((field) => connection || !field.inConnection);
  const focused = fields[focus];
  const down = (): void => onFocus((focus + 1) % fields.length);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow || (key.tab && key.shift)) {
      onFocus((focus + fields.length - 1) % fields.length);
    } else if (key.downArrow || key.tab) {
      down();
    } else if (focused?.kind === "toggle" && (input === " " || key.return)) {
      onChange({ ...values, [focused.key]: !values[focused.key] });
    } else if (focused?.kind === "choice" && (input === " " || key.return)) {
      onChoose(focused.key);
    } else if (focused?.kind === "section" && (input === " " || key.return)) {
      onConnection();
    }
    // Enter in a text field moves on, through TextInput's onSubmit.
  });

  return (
    <Box flexDirection="column">
      <Text bold>bambu-hando: sync filament profiles to BambuStudio and SpoolEase</Text>
      <Box flexDirection="column" marginY={1}>
        {fields.map((field, index) => {
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
              ) : field.kind === "section" ? (
                <Text dimColor={dimmed}>{connectionSummary(values)}</Text>
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
      <Text dimColor>
        A JSON file or URL of filament profiles shows up as Import on the menu. Folder and printers
        open a list.
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>
        ↑/↓ move · enter change · esc menu
        {focused?.kind === "text" || focused?.kind === "secret" ? "" : " · ? help"} · ctrl+c quit
      </Text>
    </Box>
  );
}
