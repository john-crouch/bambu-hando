// ABOUTME: TUI busy indicator: a turning spinner beside what bambu-hando is waiting for.
// ABOUTME: Shown on loading screens and while a run writes, so a slow console doesn't look frozen.

import { extendTheme, Spinner, ThemeContext, ThemeProvider } from "@inkjs/ui";
import { useContext, useMemo } from "react";

/** cli-spinners' "dots": braille, one column wide in every terminal (not ambiguous-width). */
const SPINNER = "dots";

export function Busy({ message, color }: { message: string; color?: string }) {
  const current = useContext(ThemeContext);
  // A color tints the whole line, frame and message, as on the screens that write.
  const tinted = useMemo(
    () =>
      color
        ? extendTheme(current, {
            components: {
              Spinner: { styles: { frame: () => ({ color }), label: () => ({ color }) } },
            },
          })
        : null,
    [current, color],
  );
  const spinner = <Spinner type={SPINNER} label={message} />;
  return tinted ? <ThemeProvider theme={tinted}>{spinner}</ThemeProvider> : spinner;
}
