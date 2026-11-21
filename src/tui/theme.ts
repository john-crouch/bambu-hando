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

// The same marks as the screens that draw their own ✓/✗ lines, all one column wide.
// figures' defaults differ (✔ ✘ ⚠ ℹ), and ℹ is an East Asian ambiguous-width character.
const VARIANT_ICONS: Record<Variant, string> = {
  success: "✓",
  error: "✗",
  warning: "!",
  info: "i",
};

export const theme = extendTheme(defaultTheme, {
  components: {
    Badge: {
      styles: {
        // A badge sits in a fixed-width column: cut it with … rather than wrap it onto a second line.
        container: ({ color }: { color: string }) => ({
          backgroundColor: color,
          wrap: "truncate-end",
        }),
      },
    },
    ProgressBar: {
      styles: {
        completed: () => ({ color: COLORS.accent }),
      },
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
