// ABOUTME: The TUI's root component: the one always-on useInput and usePaste, the terminal size, and the frame it draws.
// ABOUTME: All behavior lives in shell.ts's pure update; this turns Ink's input into messages and renders the model.

import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import { useEffect, useMemo } from "react";

import { errorMessage } from "../../errors.js";
import { keyPress } from "../core/keys.js";
import { Program, useProgram } from "../core/program.js";
import type { RunSummary, StartOptions } from "../core/types.js";
import type { FormValues } from "../core/values.js";
import { LABELS, TABS } from "./registry.js";
import { DEFAULT_LOADERS, headerStatus } from "./resources.js";
import {
  createShell,
  type Shell as ShellApi,
  type ShellDeps,
  type ShellModel,
  type ShellMsg,
} from "./shell.js";
import { COLORS, Footer, Frame, Header } from "./stub-ui.js";

const TOAST_MS = 4_000;

export const DEFAULT_DEPS: ShellDeps = {
  tabs: TABS,
  labels: LABELS,
  loaders: DEFAULT_LOADERS,
  now: () => Date.now(),
  toastMs: TOAST_MS,
};

export interface ShellProps {
  initial: FormValues;
  start: StartOptions;
  /** Tabs, loaders and clock, for tests; defaults to the real ones. */
  deps?: Partial<ShellDeps>;
  /** The session ended with q or app/quit: the exit code. */
  onExit: (code: number) => void;
  /** Every change to the session's run summaries, so they can be printed after the alternate screen closes. */
  onSummaries?: (summaries: RunSummary[]) => void;
}

function ErrorBanner({ error, columns }: { error: string; columns: number }) {
  return (
    <Box width={columns} paddingX={1} flexShrink={0}>
      <Text color={COLORS.failed} wrap="truncate-end">
        ✗ {error}
      </Text>
      <Box flexGrow={1} />
      <Text dimColor> any key dismisses</Text>
    </Box>
  );
}

/** The frame for a model: header, the active tab (or nothing but the frame), footer, and the open overlay. */
export function ShellView({ shell, model }: { shell: ShellApi; model: ShellModel }) {
  const ctx = shell.ctx(model);
  const TabView = shell.tabModule(model.active).View;
  const overlay = model.overlay ? shell.overlayModule(model.overlay.id) : null;
  const OverlayView = overlay?.View;
  return (
    <Frame
      columns={model.columns}
      rows={model.rows}
      header={
        <Header
          tabs={shell.headerTabs(model)}
          active={model.active}
          status={headerStatus(model.values, model.resources.console)}
          columns={model.columns}
        />
      }
      footer={
        <Footer
          hints={shell.hints(model)}
          columns={model.columns}
          {...(model.toast ? { toast: model.toast } : {})}
        />
      }
      overlay={
        OverlayView && model.overlay ? <OverlayView model={model.overlay.model} ctx={ctx} /> : null
      }
    >
      {model.error ? <ErrorBanner error={model.error} columns={model.columns} /> : null}
      <Box flexDirection="column" width={ctx.bodyColumns} height={ctx.bodyRows} overflow="hidden">
        <TabView model={model.tabs[model.active]} ctx={ctx} />
      </Box>
    </Frame>
  );
}

export function Shell({ initial, start, deps, onExit, onSummaries }: ShellProps) {
  const size = useWindowSize();
  // The program is made once, so the shell (and its deps) is too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are read once at mount.
  const shell = useMemo(() => createShell({ ...DEFAULT_DEPS, ...deps }), []);
  const [model, dispatch] = useProgram(
    () =>
      new Program<ShellModel, ShellMsg>(
        shell.init(initial, start, { columns: size.columns, rows: size.rows }),
        shell.update,
        (err) => ({ type: "app/error", error: errorMessage(err) }),
      ),
  );

  // The one input listener, always active: overlays and tabs get keys through the update.
  useInput((input, key) => dispatch({ type: "key", key: keyPress(input, key) }));
  usePaste((text) => dispatch({ type: "paste", text }));

  // After the first frame: start the background loads.
  useEffect(() => dispatch({ type: "shell/mounted" }), [dispatch]);

  useEffect(() => {
    if (size.columns !== model.columns || size.rows !== model.rows)
      dispatch({ type: "resize", columns: size.columns, rows: size.rows });
  }, [size.columns, size.rows, model.columns, model.rows, dispatch]);

  useEffect(() => onSummaries?.(model.summaries), [model.summaries, onSummaries]);

  useEffect(() => {
    if (model.exit !== null) onExit(model.exit);
  }, [model.exit, onExit]);

  return <ShellView shell={shell} model={model} />;
}
