// ABOUTME: OS-aware path resolution for BambuStudio user preset directories and our download cache.
// ABOUTME: Keeps platform logic isolated and easy to test.

import { homedir } from "node:os";
import { posix } from "node:path";

/** BambuStudio's data directory (BambuStudio.conf, system/ and user/ profiles) on Linux/macOS. */
export function bambuConfigDir(platform: string = process.platform, home: string = homedir()): string {
  if (platform === "linux") return posix.join(home, ".config", "BambuStudio");
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "BambuStudio");
  throw new Error(`Unsupported OS for this tool: ${platform}`);
}

/** Return the BambuStudio user root for Linux/macOS, following BambuStudio source-path conventions. */
export function bambuUserRoot(platform: string = process.platform, home: string = homedir()): string {
  return posix.join(bambuConfigDir(platform, home), "user");
}

export function bambuFilamentDir(presetFolder = "default", platform?: string, home?: string): string {
  return posix.join(bambuUserRoot(platform, home), presetFolder, "filament");
}

/** Where BambuStudio keeps custom filaments with their own filament_id (presets that inherit nothing). */
export function bambuBaseFilamentDir(presetFolder = "default", platform?: string, home?: string): string {
  return posix.join(bambuFilamentDir(presetFolder, platform, home), "base");
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
