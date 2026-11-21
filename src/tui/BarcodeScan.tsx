// ABOUTME: TUI screen that reads a spool's barcode from a scanner (which types like a keyboard) or by hand.
// ABOUTME: Key handling is pure; a scanner's whole code and enter can arrive as one input, read as one scan.

import { Box, type Key, Text } from "ink";

export type ScanAction =
  | { type: "update"; code: string }
  | { type: "submit"; code: string }
  | { type: "back" }
  | { type: "none" };

export function scanInput(code: string, input: string, key: Key): ScanAction {
  if (key.escape) return { type: "back" };
  const submit = (text: string): ScanAction =>
    text.trim() ? { type: "submit", code: text.trim() } : { type: "none" };
  if (key.return) return submit(code);
  if (key.backspace || key.delete) return { type: "update", code: code.slice(0, -1) };
  if (!input || key.ctrl || key.meta) return { type: "none" };
  // Ink hands keys that arrive together to the app as one input; a scanner sends its code and enter that way.
  const end = input.search(/[\r\n]/);
  if (end >= 0) return submit(code + input.slice(0, end));
  return { type: "update", code: code + input };
}

interface Props {
  code: string;
  error: string;
  /** Barcodes bambu-hando knows. */
  known: number;
}

export function BarcodeScan({ code, error, known }: Props) {
  return (
    <Box flexDirection="column">
      <Text bold>Barcode scan: more spools of what you scan</Text>
      <Text>Scan the spool's barcode, or type it and press enter.</Text>
      <Text dimColor>
        {known > 0
          ? `${known} known so far; a new barcode asks which filament it is, once.`
          : "A new barcode asks which filament it is, once."}
      </Text>
      <Box marginY={1}>
        <Text>Barcode: </Text>
        <Text color="cyan">{code}</Text>
        <Text inverse> </Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>scan or type · enter look up · esc menu · ? help</Text>
    </Box>
  );
}
