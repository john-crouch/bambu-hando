// ABOUTME: OS-aware path resolution for BambuStudio user preset directories and our download cache.
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

/** Per-user cache directory: $XDG_CACHE_HOME or ~/.cache on Linux, ~/Library/Caches on macOS. */
export function cacheDir(
  platform: string = process.platform,
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): string {
  if (platform === "linux") return posix.join(env.XDG_CACHE_HOME || posix.join(home, ".cache"), "bambu-hando");
  if (platform === "darwin") return posix.join(home, "Library", "Caches", "bambu-hando");
  throw new Error(`Unsupported OS for this tool: ${platform}`);
}
