// ABOUTME: Starts a private D-Bus session with its own gnome-keyring, so keyring tests never touch the login keyring.
// ABOUTME: Linux only; `privateKeyringSupported` is false elsewhere and those tests are skipped.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function installed(command: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const privateKeyringSupported =
  process.platform === "linux" &&
  installed("dbus-daemon") &&
  installed("dbus-send") &&
  installed("gnome-keyring-daemon");

export interface PrivateKeyring {
  /** Variables that point a process at this keyring's bus (and nowhere else). */
  env: Record<string, string>;
  close: () => Promise<void>;
}

function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const newline = out.indexOf("\n");
      if (newline >= 0) resolve(out.slice(0, newline).trim());
    });
    child.on("exit", (code) => reject(new Error(`exited with ${code} before printing an address`)));
  });
}

function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

/** A dbus-daemon and an unlocked gnome-keyring-daemon whose files live in a temp dir. */
export async function startPrivateKeyring(): Promise<PrivateKeyring> {
  const root = await mkdtemp(join(tmpdir(), "bh-keyring-"));
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    XDG_RUNTIME_DIR: root,
    XDG_DATA_HOME: join(root, "data"),
  };
  const bus = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const address = await firstLine(bus);
  const busEnv = { ...env, DBUS_SESSION_BUS_ADDRESS: address };
  const keyring = spawn(
    "gnome-keyring-daemon",
    ["--foreground", "--unlock", "--components=secrets"],
    {
      env: busEnv,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  keyring.stdin?.end("test-password");
  await waitForSecretService(busEnv);
  return {
    env: { DBUS_SESSION_BUS_ADDRESS: address, XDG_RUNTIME_DIR: root },
    close: async () => {
      await stopped(keyring);
      await stopped(bus);
    },
  };
}

async function waitForSecretService(env: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const names = execFileSync(
        "dbus-send",
        [
          "--session",
          "--print-reply",
          "--dest=org.freedesktop.DBus",
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus.ListNames",
        ],
        { env, encoding: "utf-8" },
      );
      if (names.includes("org.freedesktop.secrets")) return;
    } catch {
      // The bus is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the private gnome-keyring never registered org.freedesktop.secrets");
}
