// ABOUTME: A stand-in for CUPS' lp and lpstat on PATH, so printing is tested without a printer.
// ABOUTME: lp records its arguments and keeps a copy of the file; LP_FAIL makes it fail like a missing printer.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { vi } from "vitest";

/** Puts fake lp and lpstat first on PATH and returns the directory lp logs into (args, printed.pdf). */
export async function installFakeLp(home: string, destinations = ["Label-Printer", "Label-Printer/spools", "Office-Laser"]): Promise<string> {
  const bin = join(home, "bin");
  const log = join(home, "lp");
  await mkdir(bin, { recursive: true });
  await mkdir(log, { recursive: true });
  await writeFile(
    join(bin, "lp"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}/args"\nfor last; do :; done\ncp "$last" "${log}/printed.pdf"\n[ -n "$LP_FAIL" ] && { echo "lp: $LP_FAIL" >&2; exit 1; }\necho "request id is Label-7 (1 file(s))"\n`,
    { mode: 0o755 },
  );
  await writeFile(join(bin, "lpstat"), `#!/bin/sh\n[ "$1" = "-e" ] || exit 1\nprintf '%s\\n' ${destinations.map((d) => `'${d}'`).join(" ")}\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  vi.stubEnv("LP_FAIL", undefined);
  return log;
}
