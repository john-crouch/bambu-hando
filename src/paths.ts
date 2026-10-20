// ABOUTME: OS-aware path resolution for BambuStudio user preset directories.
// ABOUTME: Keeps platform logic isolated and easy to test.

import { homedir } from "node:os";
import { posix } from "node:path";

/** Return the BambuStudio user root for Linux/macOS, following BambuStudio source-path conventions. */
export function bambuUserRoot(platform: string = process.platform, home: string = homedir()): string {
  if (platform === "linux") return posix.join(home, ".config", "BambuStudio", "user");
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "BambuStudio", "user");
  throw new Error(`Unsupported OS for this tool: ${platform}`);
}

export function bambuFilamentDir(presetFolder = "default", platform?: string, home?: string): string {
  return posix.join(bambuUserRoot(platform, home), presetFolder, "filament");
}
