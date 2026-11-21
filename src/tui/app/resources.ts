// ABOUTME: The shell's background data: one loader per resource (console, presets, catalog, check) and the helpers around them.
// ABOUTME: Loaders are injectable so tests use stand-in servers; null from a loader means the resource is idle (not set up).

import type { SpoolEaseConnection } from "../../spoolease.js";
import { SpoolEaseClient } from "../../spoolease.js";
import { loadSpoolmanDb } from "../../spoolmanDb.js";
import { checkKey } from "../../sync.js";
import { readCheck, readUserPresets } from "../../syncCheck.js";
import type { Resource, ResourceId, Resources } from "../core/types.js";
import type { FormValues } from "../core/values.js";
import type { HeaderStatus } from "./stub-ui.js";

type Loaded<K extends ResourceId> = Resources[K] extends Resource<infer T> ? T : never;

/** Reads a resource for these settings; null when it can't apply (no console, say), which leaves it idle. */
export type Loaders = { [K in ResourceId]: (values: FormValues) => Promise<Loaded<K>> | null };

/** True when the session has a console to talk to: SpoolEase not skipped, and a host and key given. */
export function consoleConfigured(values: FormValues): boolean {
  return !values.skipSpoolease && values.host.trim() !== "" && values.securityKey !== "";
}

function connection(values: FormValues): SpoolEaseConnection | null {
  if (!consoleConfigured(values)) return null;
  return {
    host: values.host.trim(),
    port: Number(values.port),
    securityKey: values.securityKey,
    https: values.https,
  };
}

/** A client whose key the console accepted; throws KeyCheckError when it's unreachable or refuses the key. */
async function checkedClient(target: SpoolEaseConnection): Promise<SpoolEaseClient> {
  const client = new SpoolEaseClient(target);
  await checkKey(client);
  return client;
}

export const DEFAULT_LOADERS: Loaders = {
  console(values) {
    const target = connection(values);
    if (!target) return null;
    return (async () => {
      const client = await checkedClient(target);
      const [spools, filaments] = await Promise.all([
        client.listSpools(),
        client.getCustomFilaments(),
      ]);
      return { spools, filaments };
    })();
  },
  presets: (values) => readUserPresets(values.presetFolder.trim()),
  catalog: (values) => loadSpoolmanDb({ diameter: values.diameter }),
  check(values) {
    const target = connection(values);
    if (!target) return null;
    return (async () => readCheck(await checkedClient(target), values.presetFolder.trim()))();
  },
};

const DEPENDS_ON: Record<ResourceId, readonly (keyof FormValues)[]> = {
  console: ["host", "port", "securityKey", "https", "skipSpoolease"],
  presets: ["presetFolder"],
  catalog: ["diameter"],
  check: ["host", "port", "securityKey", "https", "skipSpoolease", "presetFolder"],
};

const RESOURCE_ORDER: readonly ResourceId[] = ["console", "presets", "catalog", "check"];

/** The resources a settings change makes out of date, in load order. */
export function affectedResources(before: FormValues, after: FormValues): ResourceId[] {
  return RESOURCE_ORDER.filter((id) =>
    DEPENDS_ON[id].some((field) => before[field] !== after[field]),
  );
}

/** The last good value of a resource, if it has had one. */
export function lastValue<T>(resource: Resource<T>): T | undefined {
  if (resource.state === "ready") return resource.value;
  if (resource.state === "idle") return undefined;
  return resource.previous;
}

/** The resource while it loads again, still showing the last good value. */
export function reloading<T>(resource: Resource<T>): Resource<T> {
  const previous = lastValue(resource);
  return previous === undefined ? { state: "loading" } : { state: "loading", previous };
}

/** BambuStudio's printer names, short: "Bambu Lab X1 Carbon 0.6 nozzle" → "X1C 0.6", more printers as "+N". */
export function printerText(printerPreset: string): string {
  const names = printerPreset
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  const first = (names[0] as string)
    .replace(/^Bambu Lab /, "")
    .replace(/^X1 Carbon\b/, "X1C")
    .replace(/ nozzle$/, "");
  return names.length > 1 ? `${first} +${names.length - 1}` : first;
}

/** The header's right end: the console's state, its host (never the key) and the printers a run writes for. */
export function headerStatus(values: FormValues, console: Resource<unknown>): HeaderStatus {
  const printers = printerText(values.printerPreset);
  if (!consoleConfigured(values)) {
    return {
      console: "skipped",
      consoleText: values.skipSpoolease ? "SpoolEase skipped" : "SpoolEase not set up",
      printerText: printers,
    };
  }
  const state =
    console.state === "ready"
      ? "ok"
      : console.state === "failed"
        ? "failed"
        : console.state === "loading"
          ? "checking"
          : "skipped";
  return { console: state, consoleText: `SpoolEase ${values.host.trim()}`, printerText: printers };
}
