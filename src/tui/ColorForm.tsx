// ABOUTME: TUI "Other color…" form: a color SpoolmanDB doesn't list, with the settings of one it does.
// ABOUTME: Key handling and validation are pure functions so App's always-on useInput can drive them.

import { Box, type Key, Text } from "ink";

import type { FilamentProfile } from "../models.js";
import { derivedFilamentId } from "../sources.js";

export const BASE_ROW = 0;
export const NAME_ROW = 1;
export const HEX_ROW = 2;
export const ADD_ROW = 3;

const HEX = /^#?([0-9a-f]{6})$/i;

export interface ColorFormState {
  /** The listed color whose settings the new one takes; null until chosen. */
  base: FilamentProfile | null;
  colorName: string;
  /** As typed: 6 hex digits, with or without "#". */
  hex: string;
  cursor: number;
  error: string;
}

export type ColorFormAction =
  | { type: "update"; state: ColorFormState }
  | { type: "choose" }
  | { type: "submit" }
  | { type: "back" };

export function initialColorForm(): ColorFormState {
  return { base: null, colorName: "", hex: "", cursor: BASE_ROW, error: "" };
}

/**
 * `base` with another color: same brand, material, temperatures, density and weights; a name ending in
 * the new color (as SpoolmanDB names end in theirs) and the ID derived from it. A slicer filament code
 * isn't carried over, since it identifies the listed color.
 */
export function colorVariant(
  base: FilamentProfile,
  colorName: string,
  colorRgba: string,
): FilamentProfile {
  const prefix =
    base.colorName && base.name.endsWith(base.colorName)
      ? base.name.slice(0, -base.colorName.length)
      : `${base.brand} ${base.material} `;
  const name = `${prefix}${colorName}`;
  return {
    ...base,
    name,
    colorName,
    colorRgba,
    slicerFilamentCode: "",
    filamentId: derivedFilamentId(name),
  };
}

/** The "#RRGGBB" typed so far, when it is one; for the live swatch. */
export function typedColor(hex: string): string | null {
  const match = HEX.exec(hex.trim());
  return match ? `#${match[1]!.toUpperCase()}` : null;
}

/** Whether keys go into free text, where ? is typed rather than opening help: the name (a hex color never has one). */
export function colorFormTyping(state: ColorFormState): boolean {
  return state.cursor === NAME_ROW;
}

export function colorFormInput(state: ColorFormState, input: string, key: Key): ColorFormAction {
  const next = (changes: Partial<ColorFormState>): ColorFormAction => ({
    type: "update",
    state: { ...state, error: "", ...changes },
  });
  const text = state.cursor === NAME_ROW ? "colorName" : state.cursor === HEX_ROW ? "hex" : null;

  if (key.escape) return { type: "back" };
  if (key.upArrow) return next({ cursor: Math.max(BASE_ROW, state.cursor - 1) });
  if (key.downArrow) return next({ cursor: Math.min(ADD_ROW, state.cursor + 1) });
  if (key.return) {
    if (state.cursor === BASE_ROW) return { type: "choose" };
    if (state.cursor === ADD_ROW) return { type: "submit" };
    return next({ cursor: state.cursor + 1 });
  }
  if (text && (key.backspace || key.delete)) return next({ [text]: state[text].slice(0, -1) });
  if (text && input && !key.ctrl && !key.meta && !key.tab)
    return next({ [text]: state[text] + input });
  return { type: "update", state };
}

export function colorFormProfile(
  state: ColorFormState,
  listed: FilamentProfile[],
): { profile: FilamentProfile } | { error: string } {
  if (!state.base) return { error: "Choose the listed color it's like" };
  const colorName = state.colorName.trim();
  if (!colorName) return { error: "Type the color's name" };
  const color = typedColor(state.hex);
  if (!color) return { error: "Type the color as 6 hex digits, such as AD0000" };
  const profile = colorVariant(state.base, colorName, `${color.slice(1)}FF`);
  const taken = listed.find((p) => p.name.toLowerCase() === profile.name.toLowerCase());
  if (taken) return { error: `${profile.name} is already listed` };
  return { profile };
}

const KEY_WIDTH = 16;
const VALUE_WIDTH = 42;

function Swatch({ color }: { color: string | null }) {
  return color ? <Text backgroundColor={color}>{"  "}</Text> : <Text dimColor>--</Text>;
}

interface Props {
  state: ColorFormState;
  brand: string;
  material: string;
}

export function ColorForm({ state, brand, material }: Props) {
  const row = (index: number, label: string, value: React.ReactNode, hint: string) => {
    const active = state.cursor === index;
    return (
      <Box key={label}>
        <Box width={2}>
          <Text>{active ? "›" : ""}</Text>
        </Box>
        <Box width={KEY_WIDTH}>
          <Text color={active ? "cyan" : undefined}>{label}</Text>
        </Box>
        <Box width={VALUE_WIDTH} paddingRight={1}>
          {value}
        </Box>
        <Text dimColor>{hint}</Text>
      </Box>
    );
  };
  const { base } = state;

  return (
    <Box flexDirection="column">
      <Text bold>
        Other color: {brand} / {material}
      </Text>
      <Text dimColor>
        Everything but the name and color comes from the listed color you choose.
      </Text>
      <Box flexDirection="column" marginY={1}>
        {row(
          BASE_ROW,
          "Settings from",
          base ? (
            <Text wrap="truncate-end">
              <Swatch color={`#${base.colorRgba.slice(0, 6)}`} /> {base.colorName} ·{" "}
              {base.nozzleTempMin}-{base.nozzleTempMax} °C · {base.labelWeight} g
            </Text>
          ) : (
            <Text>(choose)</Text>
          ),
          "enter: listed colors",
        )}
        {row(
          NAME_ROW,
          "Color name",
          <Text wrap="truncate-start">{state.colorName}</Text>,
          state.colorName ? "" : "type it as on the spool",
        )}
        {row(
          HEX_ROW,
          "Color",
          <Text>
            <Swatch color={typedColor(state.hex)} /> {state.hex}
          </Text>,
          state.hex ? "" : "type 6 hex digits, such as AD0000",
        )}
        <Box marginTop={1}>{row(ADD_ROW, "Add color", <Text />, "")}</Box>
      </Box>
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>
        ↑/↓ move · enter choose or next · type to edit name and color · esc back to colors
        {colorFormTyping(state) ? "" : " · ? help"}
      </Text>
    </Box>
  );
}
