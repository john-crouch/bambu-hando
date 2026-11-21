// ABOUTME: The app's name, bold in the pink-to-purple gradient: the header's brand and any title line.
// ABOUTME: The gradient only colors the letters: the text and its width are the plain text's.

import { Text } from "ink";
import Gradient from "ink-gradient";

import { GRADIENT } from "./theme.js";

export const APP_NAME = "bambu-hando";

export const TITLE = "bambu-hando: sync filament profiles to BambuStudio and SpoolEase";

export function Title({ text = TITLE }: { text?: string }) {
  return (
    <Text bold>
      <Gradient colors={GRADIENT}>{text}</Gradient>
    </Text>
  );
}
