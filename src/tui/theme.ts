// ABOUTME: The TUI's @inkjs/ui theme: the colors and status icons the hand-drawn screens already use.
// ABOUTME: Applied once with ThemeProvider in run.tsx, so library components match the rest of the TUI.

import { defaultTheme, extendTheme } from "@inkjs/ui";

/** The TUI's colors: cyan for the cursor and anything in progress, then green, red and yellow for outcomes. */
export const COLORS = {
  accent: "cyan",
  ok: "green",
  failed: "red",
  warning: "yellow",
  muted: "gray",
} as const;

type Variant = "success" | "error" | "warning" | "info";

const VARIANT_COLORS: Record<Variant, string> = {
  success: COLORS.ok,
  error: COLORS.failed,
  warning: COLORS.warning,
  info: COLORS.accent,
};

// The same marks as the screens that draw their own ✓/✗ and ! lines, so every status line looks alike
// (figures' defaults are ✔ ✘ ⚠ ℹ).
const VARIANT_ICONS: Record<Variant, string> = {
  success: "✓",
  error: "✗",
  warning: "!",
  info: "i",
};

/** Badge text: black on the bright colors, bright white on gray, where black is hard to read. */
function badgeText(background: string): string {
  return background === COLORS.muted ? "whiteBright" : "black";
}

export const theme = extendTheme(defaultTheme, {
  components: {
    Badge: {
      styles: {
        // A badge sits in a fixed-width column: cut it with … rather than wrap it onto a second line.
        container: ({ color }: { color: string }) => ({
          backgroundColor: color,
          color: badgeText(color),
          wrap: "truncate-end",
        }),
        // The label takes its color from the container, which knows the background.
        label: () => ({}),
      },
    },
    ProgressBar: {
      styles: {
        completed: () => ({ color: COLORS.accent }),
      },
      // East Asian "neutral" characters, one column wide in every terminal; figures' █ is ambiguous-width.
      config: () => ({ completedCharacter: "▰", remainingCharacter: "▱" }),
    },
    Spinner: {
      styles: {
        frame: () => ({ color: COLORS.accent }),
      },
    },
    StatusMessage: {
      styles: {
        icon: ({ variant }: { variant: Variant }) => ({ color: VARIANT_COLORS[variant] }),
      },
      config: ({ variant }: { variant: Variant }) => ({ icon: VARIANT_ICONS[variant] }),
    },
  },
});
