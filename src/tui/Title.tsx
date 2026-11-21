// ABOUTME: The app title shared by the home menu and the settings form, bold in a pink-to-purple gradient.
// ABOUTME: The gradient only colors the letters: the text and its width are the plain title's.

import { Text } from "ink";
import Gradient from "ink-gradient";

export const TITLE = "bambu-hando: sync filament profiles to BambuStudio and SpoolEase";

/** Mid-bright ends, so the title reads on dark and light backgrounds alike. */
const COLORS = ["#FF5F87", "#A06BFF"];

export function Title() {
  return (
    <Text bold>
      <Gradient colors={COLORS}>{TITLE}</Gradient>
    </Text>
  );
}
