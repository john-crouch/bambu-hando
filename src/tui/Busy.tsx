// ABOUTME: TUI busy indicator: a turning spinner beside what bambu-hando is waiting for.
// ABOUTME: Shown on loading screens and while a run writes, so a slow console doesn't look frozen.

import { Text } from "ink";
import { useEffect, useState } from "react";

/** Braille dots: one column wide in every terminal (not ambiguous-width). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

export function Busy({ message, color }: { message: string; color?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), FRAME_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text {...(color ? { color } : {})}>
      {SPINNER_FRAMES[frame]} {message}
    </Text>
  );
}
