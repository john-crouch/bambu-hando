// ABOUTME: The design system's palette and the @inkjs/ui theme that makes the library's display components match it.
// ABOUTME: Accent marks focus and selection only; every other color means something (a status, a swatch, a warning).

import { defaultTheme, extendTheme } from "@inkjs/ui";

export const COLORS = {
  /** Focus, the active tab, the current page, the cursor's gutter mark. */
  accent: "#A06BFF",
  /** Keys in hints and matched filter text. */
  accent2: "#FF5F87",
  ok: "#5FD787",
  warning: "#FFD75F",
  failed: "#FF5F5F",
  /** Labels, hints, codes: anything that explains rather than informs. */
  muted: "gray",
  /** The selection bar behind the cursor's row, and the text on it. */
  selection: "#3B2F5C",
  selectionText: "#FFFFFF",
  /** Unfocused panel borders. */
  border: "gray",
  /** The toast's row: a quiet bar, so the toast reads as one line of its own over whatever is under it. */
  toast: "#2A2633",
} as const;

export type Tone = "ok" | "warning" | "failed" | "muted" | "accent";

/** The color a tone draws in. */
export function toneColor(tone: Tone): string {
  return COLORS[tone];
}

/** The title gradient, pink to purple: mid-bright ends, so it reads on dark and light backgrounds alike. */
export const GRADIENT = [COLORS.accent2, COLORS.accent];

/** Status marks, one column wide in every terminal. */
export const ICONS = {
  ok: "✓",
  failed: "✗",
  warning: "!",
  info: "i",
  skipped: "-",
  current: "▸",
  ticked: "✓",
} as const;

type Variant = "success" | "error" | "warning" | "info";

const VARIANT_COLORS: Record<Variant, string> = {
  success: COLORS.ok,
  error: COLORS.failed,
  warning: COLORS.warning,
  info: COLORS.accent,
};

// The same marks as the hand-drawn status lines, so every status looks alike (figures' defaults are ✔ ✘ ⚠ ℹ).
const VARIANT_ICONS: Record<Variant, string> = {
  success: ICONS.ok,
  error: ICONS.failed,
  warning: ICONS.warning,
  info: ICONS.info,
};

/** Badge text: black on the bright colors, bright white on gray, where black is hard to read. */
function badgeText(background: string): string {
  return background === COLORS.muted || background === "gray" ? "whiteBright" : "black";
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
        remaining: () => ({ color: COLORS.muted }),
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
