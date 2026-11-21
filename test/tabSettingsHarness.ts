// ABOUTME: A miniature shell for tab tests: runs a tab's update and commands, routes its own messages back to it,
// ABOUTME: and applies app/values to the context, recording every other app message the tab sends.

import { type KeyName, press } from "../src/tui/core/keys.js";
import type { Cmd } from "../src/tui/core/program.js";
import type { AppMsg, Ctx, Resources, Step, TabId, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";

export const VALUES: FormValues = {
  source: "spoolmandb",
  presetFolder: "default",
  printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle",
  overwritePresets: false,
  host: "",
  port: "80",
  securityKey: "",
  https: false,
  skipSpoolease: false,
  createSpools: true,
  query: "",
  diameter: 1.75,
};

export const IDLE_RESOURCES: Resources = {
  console: { state: "idle" },
  presets: { state: "idle" },
  catalog: { state: "idle" },
  check: { state: "idle" },
};

export function ctxOf(values: Partial<FormValues> = {}, resources: Partial<Resources> = {}): Ctx {
  return {
    values: { ...VALUES, ...values },
    resources: { ...IDLE_RESOURCES, ...resources },
    columns: 80,
    rows: 24,
    bodyColumns: 80,
    bodyRows: 22,
    now: Date.UTC(2026, 10, 21),
  };
}

interface Tab<M> {
  update(model: M, msg: AppMsg | TabMsg, ctx: Ctx): Step<M>;
}

/** Drives one tab: messages in, its commands run (awaited), app messages out. */
export class Harness<M> {
  /** App messages the tab sent, app/values included (they're also applied to ctx). */
  sent: AppMsg[] = [];

  constructor(
    private readonly id: TabId,
    private readonly tab: Tab<M>,
    public model: M,
    public ctx: Ctx,
  ) {}

  /** Starts from init's step, running its commands. */
  static async start<M>(
    id: TabId,
    tab: Tab<M> & { init(ctx: Ctx, start: { query: string }): Step<M> },
    ctx: Ctx,
  ): Promise<Harness<M>> {
    const [model, cmds] = tab.init(ctx, { query: "" });
    const harness = new Harness(id, tab, model, ctx);
    await harness.run(cmds);
    return harness;
  }

  /** Presses keys one at a time: named keys by name, anything else as typed text. */
  async press(...keys: (KeyName | string)[]): Promise<void> {
    for (const key of keys) await this.dispatch({ type: "key", key: press(key) });
  }

  async dispatch(msg: AppMsg | TabMsg): Promise<void> {
    const [model, cmds] = this.tab.update(this.model, msg, this.ctx);
    this.model = model;
    await this.run(cmds);
  }

  /** The step's commands, run without dispatching what they send: for asserting on a single update. */
  step(msg: AppMsg | TabMsg): Step<M> {
    return this.tab.update(this.model, msg, this.ctx);
  }

  async run(cmds: Cmd<AppMsg>[]): Promise<void> {
    const inbox: AppMsg[] = [];
    for (const cmd of cmds) await cmd((msg) => inbox.push(msg));
    for (const msg of inbox) await this.receive(msg);
  }

  private async receive(msg: AppMsg): Promise<void> {
    if (msg.type === "tab" && msg.tab === this.id) return this.dispatch(msg.msg);
    this.sent.push(msg);
    if (msg.type === "app/values")
      this.ctx = { ...this.ctx, values: { ...this.ctx.values, ...msg.values } };
  }

  /** The app messages of one type the tab sent. */
  of<T extends AppMsg["type"]>(type: T): Extract<AppMsg, { type: T }>[] {
    return this.sent.filter((m): m is Extract<AppMsg, { type: T }> => m.type === type);
  }
}
