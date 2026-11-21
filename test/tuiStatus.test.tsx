// ABOUTME: Tests how the TUI's run screens report: progress while a sync runs, status messages after it.
// ABOUTME: Renders App inside the project theme against a local SpoolEase server, through a proxy that can hold requests.

import { mkdtemp } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ThemeProvider } from "@inkjs/ui";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, type FormValues } from "../src/tui/App.js";
import { theme } from "../src/tui/theme.js";
import { installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import { SOURCE_FIXTURE } from "./parity.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const ENTER = "\r";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** Forwards requests to the test console, parking the ones `hold` picks until `release`. */
interface HoldingProxy {
  port: number;
  hold: (method: string, path: string) => boolean;
  release: () => void;
  close: () => Promise<void>;
}

async function startHoldingProxy(target: number): Promise<HoldingProxy> {
  const parked: (() => void)[] = [];
  const proxy: HoldingProxy = {
    port: 0,
    hold: () => false,
    release: () => {
      for (const forward of parked.splice(0)) forward();
      proxy.hold = () => false;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((req, res) => {
    const forward = () => {
      const upstream = request(
        {
          host: "127.0.0.1",
          port: target,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      req.pipe(upstream);
    };
    if (proxy.hold(req.method ?? "", req.url ?? "")) parked.push(forward);
    else forward();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  proxy.port = (server.address() as AddressInfo).port;
  return proxy;
}

describe("TUI run reports", () => {
  let server: SpoolEaseServer;
  let proxy: HoldingProxy;
  let onExit: ReturnType<typeof vi.fn<(code: number) => void>>;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-tui-status-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    server = await startSpoolEaseServer();
    proxy = await startHoldingProxy(server.port);
    onExit = vi.fn<(code: number) => void>();
  });

  afterEach(async () => {
    proxy.release();
    await proxy.close();
    await server.close();
  });

  function values(overrides: Partial<FormValues> = {}): FormValues {
    return {
      source: SOURCE_FIXTURE,
      presetFolder: "default",
      printerPreset: X1C_04,
      host: "127.0.0.1",
      port: String(proxy.port),
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

  function renderApp(initial: FormValues) {
    return render(
      <ThemeProvider theme={theme}>
        <App initial={initial} onExit={onExit} />
      </ThemeProvider>,
    );
  }

  async function press(stdin: { write: (data: string) => void }, ...keys: string[]): Promise<void> {
    for (const key of keys) {
      stdin.write(key);
      await settle();
    }
  }

  /** Opens the import's plan, keeping the source's weights when spools are created. */
  async function openPlan(
    stdin: { write: (data: string) => void },
    lastFrame: () => string | undefined,
    createSpools: boolean,
  ): Promise<void> {
    await press(stdin, ENTER);
    if (createSpools) {
      for (const step of ["brand 1 of 2", "brand 2 of 2"]) {
        await vi.waitFor(() => expect(lastFrame()).toContain(step));
        await press(stdin, ENTER);
      }
    }
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
  }

  const lines = (frame: string | undefined): string[] => (frame ?? "").split("\n");

  it("shows a bar of the profiles finished while the run is on its way", async () => {
    const { lastFrame, stdin } = renderApp(values());
    await openPlan(stdin, lastFrame, true);
    // The first spool goes through, the second waits, so one profile of three is finished.
    let adds = 0;
    proxy.hold = (method, path) =>
      method === "POST" && path === "/api/spools/add-edit" && ++adds > 1;
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("1/3 profiles finished"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain(`${"█".repeat(10)}${"░".repeat(20)} 1/3 profiles finished`);
    expect(frame).toMatch(/PETG Red .* WRITTEN +WRITTEN/);
    expect(frame).toMatch(/Café Crème PLA .* WRITTEN +[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working/);

    proxy.release();
    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(lastFrame()).not.toContain("profiles finished");
  });

  it("reports a clean run as a success", async () => {
    const { lastFrame, stdin } = renderApp(values({ skipSpoolease: true }));
    await openPlan(stdin, lastFrame, false);
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("✓ Done: 3 written, 0 failed"));
  });

  it("reports a run with failures as errors, one line per failed profile", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "spool store full" };
    const { lastFrame, stdin } = renderApp(values());
    await openPlan(stdin, lastFrame, true);
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("✗ Done: 0 written, 3 failed"));
    const failed = lines(lastFrame()).filter((line) => line.startsWith("✗ "));
    expect(failed).toHaveLength(4);
    expect(failed[1]).toMatch(/^✗ PETG Red: registered PABC1234; spool rejected: HTTP 500/);
  });

  it("shows the run's warnings as warnings, wrapped under their text", async () => {
    const reason = `console refused the list ${"because it is far too long ".repeat(4)}`.trim();
    server.replies["POST /api/filaments-config"] = { status: 500, body: reason };
    const { lastFrame, stdin } = renderApp(values({ createSpools: false }));
    await openPlan(stdin, lastFrame, false);
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 0 written, 3 failed"));
    const all = lines(lastFrame());
    const start = all.findIndex((line) =>
      line.startsWith("! Failed to set custom filaments CSV: HTTP 500: console refused"),
    );
    expect(start).toBeGreaterThan(-1);
    expect(all[start + 1]).toMatch(/^ {2}\S/);
  });

  it("shows a run that couldn't start as an error", async () => {
    const { lastFrame, stdin } = renderApp(values({ securityKey: "WRONG", createSpools: false }));
    await openPlan(stdin, lastFrame, false);
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toMatch(/^✗ SpoolEase key validation failed/m));
    expect(lastFrame()).toContain("[b] back to settings · [q] quit · ? help");
  });
});
