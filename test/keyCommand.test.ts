// ABOUTME: Integration tests for `bambu-hando key`: storing, reporting and removing API keys from piped input.
// ABOUTME: Runs main() in-process against a private gnome-keyring; the value must never reach any output.

import { Readable } from "node:stream";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { removeSecret, SECRETS, storedSecret, storeSecret } from "../src/secrets.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";

const TDFP = SECRETS["3dfp"];
const KEY = "3dfp_fake_key_for_tests";

async function run(argv: string[], stdin = ""): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), stdin: Readable.from(stdin ? [stdin] : []) });
  expect(stdout + stderr).not.toContain("fake_key");
  return { code, stdout, stderr };
}

describe("bambu-hando key usage", () => {
  it("prints usage for no action and for --help", async () => {
    for (const argv of [["key"], ["key", "--help"], ["key", "set", "-h"]]) {
      const { code, stdout } = await run(argv);
      expect(code).toBe(0);
      expect(stdout).toContain("Usage: bambu-hando key <set|status|remove> [name]");
      expect(stdout).toContain("FILAMENTPROFILES_API_KEY");
    }
  });

  it("rejects an unknown action", async () => {
    const { code, stderr } = await run(["key", "show", "3dfp"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown action (set, status or remove)");
    expect(stderr).not.toContain("show");
  });

  it("rejects an unknown key name and lists the known ones", async () => {
    const { code, stderr } = await run(["key", "set", "github"], KEY);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown key (known: 3dfp)");
    expect(stderr).not.toContain("github");
  });

  it("needs a key name to set or remove", async () => {
    expect((await run(["key", "set"], KEY)).stderr).toContain("say which key");
    expect((await run(["key", "remove"])).code).toBe(2);
  });

  it("explains that nothing was piped in when stdin is neither a terminal nor has a key", async () => {
    const { code, stderr } = await run(["key", "set", "3dfp"], "");
    expect(code).toBe(2);
    expect(stderr).toContain("no key was piped in, and stdin isn't a terminal to prompt on: run this in a terminal, or pipe the key in");
  });

  it("refuses a key given as an argument, without repeating it", async () => {
    for (const argv of [["key", "set", "3dfp", KEY], ["key", "set", "3dfp", `--key=${KEY}`], ["key", "set", KEY], ["key", "status", KEY], ["key", KEY]]) {
      const { code, stderr } = await run(argv);
      expect(code).toBe(2);
      expect(stderr).toContain("never taken as arguments");
      expect(stderr).toContain("shell history");
    }
  });
});

describe.skipIf(!privateKeyringSupported)("bambu-hando key with a keyring", () => {
  let keyring: PrivateKeyring;

  beforeAll(async () => {
    keyring = await startPrivateKeyring();
  });

  afterAll(async () => {
    await keyring.close();
  });

  beforeEach(() => {
    for (const [name, value] of Object.entries(keyring.env)) vi.stubEnv(name, value);
    vi.stubEnv(TDFP.env, undefined);
  });

  afterEach(async () => {
    await removeSecret(TDFP);
    vi.unstubAllEnvs();
  });

  it("stores a piped key in the keyring", async () => {
    const { code, stdout, stderr } = await run(["key", "set", "3dfp"], `${KEY}\n`);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe("Stored the 3DFilamentProfiles API key in the system keyring (Secret Service).\n");
    expect(await storedSecret(TDFP)).toBe(KEY);
  });

  it("says when it replaces a stored key", async () => {
    await storeSecret(TDFP, "old-key");
    const { code, stdout } = await run(["key", "set", "3dfp"], KEY);
    expect(code).toBe(0);
    expect(stdout).toContain("Replaced the 3DFilamentProfiles API key");
    expect(await storedSecret(TDFP)).toBe(KEY);
  });

  it("refuses an empty or malformed key and stores nothing", async () => {
    for (const input of ["", "\n", "3dfp_two words", "not-a-3dfp-key"]) {
      const { code, stderr } = await run(["key", "set", "3dfp"], input);
      expect(code).toBe(2);
      expect(stderr).toMatch(/empty|spaces or control characters|no key was piped in|start with 3dfp_/);
    }
    expect(await storedSecret(TDFP)).toBeNull();
  });

  it("warns that the environment variable overrides the key it stores", async () => {
    vi.stubEnv(TDFP.env, "env-key");
    const { code, stderr } = await run(["key", "set", "3dfp"], KEY);
    expect(code).toBe(0);
    expect(stderr).toContain("FILAMENTPROFILES_API_KEY is set and overrides the stored key");
  });

  it("reports where each key comes from, never its value", async () => {
    expect((await run(["key", "status"])).stdout).toBe("3dfp  3DFilamentProfiles API key: not set (bambu-hando key set 3dfp)\n");

    await storeSecret(TDFP, KEY);
    expect((await run(["key", "status", "3dfp"])).stdout).toBe("3dfp  3DFilamentProfiles API key: stored in the system keyring (Secret Service)\n");

    vi.stubEnv(TDFP.env, "env-key");
    expect((await run(["key", "status"])).stdout).toBe(
      "3dfp  3DFilamentProfiles API key: from FILAMENTPROFILES_API_KEY (overrides the one stored in the system keyring (Secret Service))\n",
    );
    await removeSecret(TDFP);
    expect((await run(["key", "status"])).stdout).toBe("3dfp  3DFilamentProfiles API key: from FILAMENTPROFILES_API_KEY\n");
  });

  it("removes a stored key, and says so when there was none", async () => {
    await storeSecret(TDFP, KEY);
    expect(await run(["key", "remove", "3dfp"])).toMatchObject({ code: 0, stdout: "Removed the 3DFilamentProfiles API key from the system keyring (Secret Service).\n" });
    expect(await storedSecret(TDFP)).toBeNull();
    expect(await run(["key", "remove", "3dfp"])).toMatchObject({ code: 0, stdout: "No 3DFilamentProfiles API key was stored.\n" });
  });
});
