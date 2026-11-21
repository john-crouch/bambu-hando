// ABOUTME: Tests the Settings tab keeping the SpoolEase security key in the system keyring: saved, replaced, forgotten.
// ABOUTME: Runs against a private gnome-keyring on its own D-Bus session, never the login keyring; the key never shows.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { removeSecret, SECRETS, storedSecret, storeSecret } from "../src/secrets.js";
import { press } from "../src/tui/core/keys.js";
import { toTab } from "../src/tui/core/types.js";
import { pageRows } from "../src/tui/tabs/settings/fields.js";
import { type SettingsModel, settingsLogic } from "../src/tui/tabs/settings/model.js";
import { rememberConsole } from "../src/tuiSettings.js";
import { installSpoolEaseConfig } from "./bambuStudioSetup.js";
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

/** Turns "Use SpoolEase" on (or off) from the SpoolEase page. */
async function toggleSpoolEase(h: Harness<SettingsModel>): Promise<void> {
  const index = pageRows(h.model.page, h.ctx, h.model).findIndex(
    (r) => r.label === "Use SpoolEase",
  );
  await h.press("home");
  for (let i = 0; i < index; i++) await h.press("down");
  await h.press("enter");
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

  let home: string;

  beforeEach(async () => {
    for (const [name, value] of Object.entries(keyring.env)) vi.stubEnv(name, value);
    home = await mkdtemp(join(tmpdir(), "bh-settings-keyring-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
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

  it("loads the stored key when SpoolEase is turned on after --skip-spoolease, never showing it", async () => {
    await storeSecret(CONSOLE, "STOREDKEY");
    const h = await onKeyRow({ skipSpoolease: true, host: "10.0.0.5" });
    await toggleSpoolEase(h);
    expect(h.ctx.values).toMatchObject({ skipSpoolease: false, securityKey: "STOREDKEY" });
    expect(
      pageRows(h.model.page, h.ctx, h.model).find((r) => r.field === "securityKey"),
    ).toMatchObject({ value: "set" });
    expect(JSON.stringify(h.sent.filter((m) => m.type !== "app/values"))).not.toContain(
      "STOREDKEY",
    );
  });

  it("keeps the session's key when SpoolEase is turned on, and loads nothing when it's turned off", async () => {
    await storeSecret(CONSOLE, "STOREDKEY");
    const h = await onKeyRow({ skipSpoolease: true, host: "10.0.0.5", securityKey: "FROM-FLAG" });
    await toggleSpoolEase(h);
    expect(h.ctx.values.securityKey).toBe("FROM-FLAG");
    const off = await onKeyRow({ host: "10.0.0.5" });
    await toggleSpoolEase(off);
    expect(off.ctx.values).toMatchObject({ skipSpoolease: true, securityKey: "" });
  });

  it("loads the key that belongs to the host shown, not one saved for another console", async () => {
    // Settings saved console B with its key; BambuStudio has console A with A's key; the session shows A.
    await storeSecret(CONSOLE, "KEY-OF-B");
    await rememberConsole({ host: "10.0.0.5", port: 80 });
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "KEY-OF-A" });
    const h = await onKeyRow({ skipSpoolease: true, host: "10.0.0.9" });
    await toggleSpoolEase(h);
    expect(h.ctx.values.securityKey).toBe("KEY-OF-A");
  });

  it("drops a stored key that arrives after the session's console changed", async () => {
    const h = await onKeyRow({ host: "10.0.0.6" });
    await h.dispatch(
      toTab("settings", { type: "settings/storedKey", host: "10.0.0.5", key: "STALE" }),
    );
    expect(h.ctx.values.securityKey).toBe("");
    expect(h.of("app/values")).toEqual([]);
  });

  it("says, without quoting it, when SPOOLEASE_SECURITY_KEY can't be used as SpoolEase is turned on", async () => {
    vi.stubEnv(CONSOLE.env, "LEAK\tME");
    const h = await onKeyRow({ skipSpoolease: true, host: "10.0.0.5" });
    await toggleSpoolEase(h);
    expect(h.ctx.values.securityKey).toBe("");
    const toasts = h.of("app/toast");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: "warning" });
    expect(toasts[0]?.text).toContain("SPOOLEASE_SECURITY_KEY");
    expect(JSON.stringify(h.sent)).not.toContain("LEAK");
  });
});
