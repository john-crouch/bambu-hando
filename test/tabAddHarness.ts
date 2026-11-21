// ABOUTME: Shared fixtures for the Add tab tests: filament profiles, a Ctx, and a loop that runs update and its commands.
// ABOUTME: The loop feeds the tab's own messages back into update, like the shell does, and records the app messages.

import { readFileSync } from "node:fs";

import type { FilamentProfile } from "../src/models.js";
import { type Catalog, catalogProfiles } from "../src/spoolmanDb.js";
import type { KeyPress } from "../src/tui/core/keys.js";
import type { Cmd } from "../src/tui/core/program.js";
import type { AppMsg, Ctx, Resources, Step, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";

export function profile(overrides: Partial<FilamentProfile> = {}): FilamentProfile {
  const brand = overrides.brand ?? "Acme";
  const material = overrides.material ?? "PLA";
  const colorName = overrides.colorName ?? "Red";
  return {
    name: `${brand} ${material} ${colorName}`,
    brand,
    material,
    colorName,
    colorRgba: "FF0000FF",
    nozzleTempMin: 200,
    nozzleTempMax: 220,
    density: 1.24,
    diameter: 1.75,
    slicerFilamentCode: "",
    filamentId: `P${(brand + material + colorName).toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(
      0,
      8,
    ),
    labelWeight: 1000,
    coreWeight: 200,
    ...overrides,
  };
}

/** A small catalog: two brands, Acme with two materials (PLA three colors, PETG one), Sunlu with PLA only. */
export const PROFILES: FilamentProfile[] = [
  profile({ colorName: "Red", filamentId: "PACMRED0" }),
  profile({ colorName: "Blue", colorRgba: "0000FFFF", filamentId: "PACMBLU0" }),
  profile({ colorName: "Black", colorRgba: "000000FF", filamentId: "PACMBLK0" }),
  profile({
    material: "PETG",
    colorName: "Clear",
    filamentId: "PACMCLR0",
    nozzleTempMin: 230,
    nozzleTempMax: 250,
  }),
  profile({ brand: "Sunlu", colorName: "White", colorRgba: "FFFFFFFF", filamentId: "PSUNWHT0" }),
];

export function catalog(profiles = PROFILES, warnings: string[] = []): Catalog {
  return { profiles, warnings };
}

/** The real SpoolmanDB fixture entries, as loadSpoolmanDb maps them. */
export function fixtureCatalog(): Catalog {
  const dir = new URL("./fixtures/spoolmandb/", import.meta.url);
  const read = (file: string) => JSON.parse(readFileSync(new URL(file, dir), "utf-8"));
  return {
    profiles: catalogProfiles(read("filaments.json"), read("materials.json"), 1.75),
    warnings: [],
  };
}

export function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    source: "",
    presetFolder: "default",
    printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle",
    overwritePresets: false,
    host: "",
    port: "80",
    securityKey: "",
    https: false,
    skipSpoolease: true,
    createSpools: true,
    query: "",
    diameter: 1.75,
    ...overrides,
  };
}

export function resources(overrides: Partial<Resources> = {}): Resources {
  return {
    console: { state: "idle" },
    presets: { state: "idle" },
    catalog: { state: "ready", value: catalog(), at: 0 },
    check: { state: "idle" },
    ...overrides,
  };
}

export function ctx(
  overrides: { values?: Partial<FormValues>; resources?: Partial<Resources> } = {},
): Ctx {
  return {
    values: values(overrides.values),
    resources: resources(overrides.resources),
    columns: 100,
    rows: 30,
    bodyColumns: 100,
    bodyRows: 28,
    now: Date.UTC(2026, 10, 21),
  };
}

export interface Tab<M> {
  update(model: M, msg: AppMsg | TabMsg, ctx: Ctx): Step<M>;
}

/**
 * Drives a tab like the shell: keys and messages go through update; each command runs, its tab messages
 * go back into update and every other message is recorded in `sent`. settle() waits for all of it.
 */
export class Driver<M> {
  readonly sent: AppMsg[] = [];
  private pending: Promise<void>[] = [];

  constructor(
    private readonly tab: Tab<M>,
    public model: M,
    public context: Ctx,
    cmds: Cmd<AppMsg>[] = [],
  ) {
    this.run(cmds);
  }

  msg(msg: AppMsg | TabMsg): this {
    const [model, cmds] = this.tab.update(this.model, msg, this.context);
    this.model = model;
    this.run(cmds);
    return this;
  }

  key(...keys: KeyPress[]): this {
    for (const key of keys) this.msg({ type: "key", key });
    return this;
  }

  /** Runs commands until none is left, including those that messages they dispatched asked for. */
  async settle(): Promise<this> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      await Promise.all(batch);
    }
    return this;
  }

  /** The recorded app messages of one type. */
  of<T extends AppMsg["type"]>(type: T): Extract<AppMsg, { type: T }>[] {
    return this.sent.filter((m): m is Extract<AppMsg, { type: T }> => m.type === type);
  }

  private run(cmds: Cmd<AppMsg>[]): void {
    for (const cmd of cmds) {
      const done = Promise.resolve(cmd((msg) => this.dispatch(msg)));
      this.pending.push(done.then(() => undefined));
    }
  }

  private dispatch(msg: AppMsg): void {
    if (msg.type === "tab" && msg.tab === "add") this.msg(msg.msg);
    else this.sent.push(msg);
  }
}
