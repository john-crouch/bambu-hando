// ABOUTME: Tests that App hands each screen the console's real URL, in a terminal that supports hyperlinks.
// ABOUTME: FORCE_HYPERLINK=1 makes ink-link draw OSC 8 links, so the frame shows which URL each screen opens.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_HYPERLINK = "1";
});

import { App, type FormValues } from "../src/tui/App.js";
import { installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const ENTER = "\r";
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const link = (url: string, text: string) => `\u001B]8;;${url}\u0007${text}`;

describe("App's console links", () => {
  let server: SpoolEaseServer;
  const onExit = vi.fn<(code: number) => void>();

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-link-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    await installBambuStudio(home);
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function values(overrides: Partial<FormValues> = {}): FormValues {
    return {
      source: "spoolmandb",
      presetFolder: "default",
      printerPreset: X1C_04,
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      https: false,
      skipSpoolease: false,
      createSpools: true,
      overwritePresets: false,
      query: "",
      diameter: 1.75,
      ...overrides,
    };
  }

  it("links the home menu's console with https and its port", async () => {
    const { lastFrame } = render(
      <App
        initial={values({ host: "spoolease.local", port: "8443", https: true })}
        onExit={onExit}
      />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("SpoolEase: "));
    expect(lastFrame()).toContain(
      `SpoolEase: ${link("https://spoolease.local:8443", "spoolease.local")}`,
    );
  });

  it("links the sync check's console", async () => {
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();
    stdin.write("c");
    await settle();
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("check again"));
    const target = `127.0.0.1:${server.port}`;
    expect(lastFrame()).toContain(`SpoolEase ${link(`http://${target}`, target)}`);
  });
});
