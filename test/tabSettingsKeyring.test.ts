// ABOUTME: Tests the Settings tab keeping the SpoolEase security key in the system keyring: saved, replaced, forgotten.
// ABOUTME: Runs against a private gnome-keyring on its own D-Bus session, never the login keyring; the key never shows.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { removeSecret, SECRETS, storedSecret, storeSecret } from "../src/secrets.js";
import { press } from "../src/tui/core/keys.js";
import { pageRows } from "../src/tui/tabs/settings/fields.js";
import { type SettingsModel, settingsLogic } from "../src/tui/tabs/settings/model.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";
import { ctxOf, Harness } from "./tabSettingsHarness.js";

const CONSOLE = SECRETS.spoolease;
const KEYRING = "the system keyring (Secret Service)";

async function onKeyRow(values = {}): Promise<Harness<SettingsModel>> {
  const h = await Harness.start("settings", settingsLogic, ctxOf(values));
  await h.press("right");
  const index = pageRows(h.model.page, h.ctx, h.model).findIndex((r) => r.label === "Security key");
  await h.press("home");
  for (let i = 0; i < index; i++) await h.press("down");
  return h;
}

async function retypeKey(h: Harness<SettingsModel>, text: string): Promise<void> {
  await h.press("enter");
  await h.dispatch({ type: "key", key: press("u", { ctrl: true }) });
  for (const c of text) await h.press(c);
  await h.press("enter");
}

describe.skipIf(!privateKeyringSupported)("the Settings tab and the keyring", () => {
  let keyring: PrivateKeyring;

  beforeAll(async () => {
    keyring = await startPrivateKeyring();
  });

  afterAll(async () => {
    await keyring.close();
  });

  beforeEach(async () => {
    for (const [name, value] of Object.entries(keyring.env)) vi.stubEnv(name, value);
    vi.stubEnv("HOME", await mkdtemp(join(tmpdir(), "bh-settings-keyring-")));
    vi.stubEnv(CONSOLE.env, undefined);
  });

  afterEach(async () => {
    await removeSecret(CONSOLE);
    vi.unstubAllEnvs();
  });

  it("stores a typed key in the keyring and says so, never showing it", async () => {
    const h = await onKeyRow();
    await retypeKey(h, "STOREDKEY");
    expect(await storedSecret(CONSOLE)).toBe("STOREDKEY");
    expect(h.ctx.values.securityKey).toBe("STOREDKEY");
    expect(h.of("app/toast")).toEqual([
      { type: "app/toast", text: `SpoolEase key saved in ${KEYRING}`, tone: "ok" },
    ]);
    expect(
      pageRows(h.model.page, h.ctx, h.model).find((r) => r.field === "securityKey"),
    ).toMatchObject({ value: "set", kept: true });
  });

  it("stores the key again when the same one is saved, so a key from elsewhere can be kept", async () => {
    const h = await onKeyRow({ securityKey: "FROM-BAMBU" });
    await h.press("enter", "enter");
    expect(await storedSecret(CONSOLE)).toBe("FROM-BAMBU");
  });

  it("says SPOOLEASE_SECURITY_KEY still wins while it's set", async () => {
    vi.stubEnv(CONSOLE.env, "ENVKEY");
    const h = await onKeyRow();
    await retypeKey(h, "STOREDKEY");
    expect(h.of("app/toast")[0]?.text).toBe(
      `SpoolEase key saved in ${KEYRING}; SPOOLEASE_SECURITY_KEY overrides it while it's set`,
    );
    expect(JSON.stringify(h.sent)).not.toContain("ENVKEY");
  });

  it("forgets the stored key when the field is emptied", async () => {
    await storeSecret(CONSOLE, "STOREDKEY");
    const h = await onKeyRow({ securityKey: "STOREDKEY" });
    await retypeKey(h, "");
    expect(await storedSecret(CONSOLE)).toBeNull();
    expect(h.ctx.values.securityKey).toBe("");
    expect(h.of("app/toast")).toEqual([
      { type: "app/toast", text: `SpoolEase key removed from ${KEYRING}`, tone: "ok" },
    ]);
    await retypeKey(h, "");
    expect(h.of("app/toast")[1]?.text).toBe(
      `SpoolEase key cleared for this session; none was stored in ${KEYRING}`,
    );
  });
});
