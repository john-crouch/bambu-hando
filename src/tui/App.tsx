// ABOUTME: Root TUI component: setup form → (SpoolmanDB picker) → plan → live apply → summary, plus error screen.
// ABOUTME: Runs the shared sync orchestration and reports the process exit code via onExit.

import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import { type FilamentProfile, resultFailed, type SyncResult } from "../models.js";
import { bambuBaseFilamentDir } from "../paths.js";
import { loadProfiles } from "../sources.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../spoolease.js";
import { type Catalog, filterProfiles, loadSpoolmanDb, SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import { applyWeights, readSpoolWeights, type WeightChoice, type WeightGroup, weightGroups } from "../spoolWeights.js";
import { checkKey, KeyCheckError, runSync, SetupError, type SyncEvent, type SyncStage } from "../sync.js";
import { initialPickerState, Picker, pickerInput } from "./Picker.js";
import { PlanTable, type RowProgress } from "./PlanTable.js";
import { SetupForm } from "./SetupForm.js";
import { itemIndex, WeightMenu, weightInput, weightItems } from "./WeightMenu.js";

export interface FormValues {
  source: string;
  presetFolder: string;
  /** Comma-separated BambuStudio printer names; one preset is written per printer. */
  printerPreset: string;
  /** Replace BambuStudio presets that already exist. */
  overwritePresets: boolean;
  host: string;
  port: string;
  securityKey: string;
  https: boolean;
  skipSpoolease: boolean;
  createSpools: boolean;
  /** Initial SpoolmanDB search. */
  query: string;
  /** SpoolmanDB filament diameter in mm. */
  diameter: number;
}

type Screen =
  | { name: "form"; error: string }
  | { name: "loading"; message: string }
  | { name: "pick" }
  /** One menu per brand in prompts; groups covers every brand, including those decided without asking. */
  | { name: "weights"; profiles: FilamentProfile[]; groups: WeightGroup[]; prompts: WeightGroup[]; step: number; cursor: number }
  | { name: "plan"; profiles: FilamentProfile[] }
  | { name: "running"; profiles: FilamentProfile[] }
  | { name: "done"; profiles: FilamentProfile[]; results: SyncResult[] }
  | { name: "error"; message: string; exitCode: number };

const STAGE_LABELS: Record<SyncStage, string> = {
  presets: "Writing BambuStudio presets",
  "key-check": "Checking SpoolEase security key",
  "custom-filaments": "Uploading custom filaments to SpoolEase",
  spools: "Creating SpoolEase spools",
};

function printers(values: FormValues): string[] {
  return values.printerPreset
    .split(",")
    .map((printer) => printer.trim())
    .filter(Boolean);
}

function validate(values: FormValues): string {
  if (!values.source.trim()) return "Source is required";
  if (printers(values).length === 0) return "Printer preset is required";
  if (values.skipSpoolease) return "";
  if (!values.host.trim() || !values.securityKey) {
    return "SpoolEase host and security key are required unless Skip SpoolEase is on";
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return "SpoolEase port must be a number between 1 and 65535";
  return "";
}

function connection(values: FormValues): SpoolEaseConnection | null {
  if (values.skipSpoolease) return null;
  return { host: values.host.trim(), port: Number(values.port), securityKey: values.securityKey, https: values.https };
}

function applyEvent(progress: RowProgress[], event: SyncEvent): RowProgress[] {
  if (event.type !== "preset" && event.type !== "spool") return progress;
  const next = [...progress];
  next[event.index] = { ...next[event.index], [event.type]: event.status };
  return next;
}

interface Props {
  initial: FormValues;
  onExit: (code: number) => void;
}

export function App({ initial, onExit }: Props) {
  const [values, setValues] = useState(initial);
  const [screen, setScreen] = useState<Screen>({ name: "form", error: "" });
  const [progress, setProgress] = useState<RowProgress[]>([]);
  const [stage, setStage] = useState<SyncStage | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [picker, setPicker] = useState(() => initialPickerState(initial.query));
  // Empty spool weight per brand key; kept while going back and forth so earlier picks stay selected.
  const [weightChoices, setWeightChoices] = useState<ReadonlyMap<string, WeightChoice>>(new Map());
  const [weightWarnings, setWeightWarnings] = useState<string[]>([]);
  const matches = useMemo(
    () => (catalog ? filterProfiles(catalog.profiles, { brand: "", material: "", match: picker.query }) : []),
    [catalog, picker.query],
  );
  const fromSpoolmanDb = values.source.trim() === SPOOLMANDB_SOURCE;
  const sourceName = fromSpoolmanDb ? "SpoolmanDB" : "Source file";

  function showPlan(profiles: FilamentProfile[]): void {
    setProgress([]);
    setScreen({ name: "plan", profiles });
  }

  function back(): void {
    setScreen(fromSpoolmanDb && catalog ? { name: "pick" } : { name: "form", error: "" });
  }

  // New spools need an empty spool weight: ask per brand when SpoolEase's catalog doesn't settle it.
  async function chooseWeights(profiles: FilamentProfile[]): Promise<void> {
    const target = connection(values);
    setWeightWarnings([]);
    if (!target || !values.createSpools) {
      showPlan(profiles);
      return;
    }
    setScreen({ name: "loading", message: "Reading spool weights from SpoolEase…" });
    try {
      // A wrong key would otherwise surface as an unreadable My Spools List.
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const { entries, warnings } = await readSpoolWeights(client);
      setWeightWarnings(warnings);
      const groups = weightGroups(profiles, entries);
      const prompts = groups.filter((g) => g.options.length !== 1);
      if (prompts.length === 0) {
        showPlan(applyWeights(profiles, groups, weightChoices));
        return;
      }
      const first = prompts[0]!;
      const cursor = itemIndex(weightItems(first, profiles, sourceName), weightChoices.get(first.key));
      setScreen({ name: "weights", profiles, groups, prompts, step: 0, cursor });
    } catch (err) {
      setScreen({ name: "form", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function loadPlan(): Promise<void> {
    const error = validate(values);
    if (error) {
      setScreen({ name: "form", error });
      return;
    }
    setScreen({ name: "loading", message: fromSpoolmanDb ? "Loading SpoolmanDB…" : `Loading profiles from ${values.source}…` });
    try {
      if (fromSpoolmanDb) {
        setCatalog(await loadSpoolmanDb({ diameter: values.diameter }));
        setScreen({ name: "pick" });
        return;
      }
      const profiles = await loadProfiles(values.source.trim());
      await chooseWeights(profiles);
    } catch (err) {
      setScreen({ name: "form", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function apply(profiles: FilamentProfile[]): Promise<void> {
    setScreen({ name: "running", profiles });
    setProgress([]);
    setWarnings([]);
    try {
      const { results } = await runSync(
        {
          profiles,
          presetFolder: values.presetFolder.trim(),
          printers: printers(values),
          overwritePresets: values.overwritePresets,
          dryRun: false,
          spoolease: connection(values),
          createSpools: values.createSpools,
        },
        (event) => {
          if (event.type === "stage") setStage(event.stage);
          else if (event.type === "warning") setWarnings((w) => [...w, event.message]);
          else setProgress((p) => applyEvent(p, event));
        },
      );
      setScreen({ name: "done", profiles, results });
    } catch (err) {
      setScreen({
        name: "error",
        message: err instanceof Error ? err.message : String(err),
        exitCode: err instanceof KeyCheckError || err instanceof SetupError ? 2 : 1,
      });
    } finally {
      setStage(null);
    }
  }

  // Always subscribed: toggling isActive re-attaches Ink's listener in an effect after the
  // new screen renders, so a key pressed right after "Done" appears could be dropped.
  useInput((input, key) => {
    if (screen.name === "pick") {
      const action = pickerInput(picker, input, key, matches);
      if (action.type === "update") setPicker(action.state);
      else if (action.type === "back") setScreen({ name: "form", error: "" });
      else if (catalog) void chooseWeights(catalog.profiles.filter((p) => picker.selected.has(p.filamentId)));
    } else if (screen.name === "weights") {
      const { profiles, groups, prompts, step } = screen;
      const items = weightItems(prompts[step]!, profiles, sourceName);
      const action = weightInput(screen.cursor, key, items.length);
      const cursorFor = (index: number, choices: ReadonlyMap<string, WeightChoice>): number =>
        itemIndex(weightItems(prompts[index]!, profiles, sourceName), choices.get(prompts[index]!.key));
      if (action.type === "move") {
        setScreen({ ...screen, cursor: action.cursor });
      } else if (action.type === "back") {
        if (step === 0) back();
        else setScreen({ ...screen, step: step - 1, cursor: cursorFor(step - 1, weightChoices) });
      } else if (action.type === "choose") {
        const choices = new Map(weightChoices).set(prompts[step]!.key, items[screen.cursor]!.choice);
        setWeightChoices(choices);
        if (step + 1 < prompts.length) setScreen({ ...screen, step: step + 1, cursor: cursorFor(step + 1, choices) });
        else showPlan(applyWeights(profiles, groups, choices));
      }
    } else if (screen.name === "plan") {
      if (input === "a") void apply(screen.profiles);
      else if (input === "b") back();
      else if (input === "q") onExit(0);
    } else if (screen.name === "done") {
      if (input === "q") onExit(screen.results.some(resultFailed) ? 1 : 0);
    } else if (screen.name === "error") {
      if (input === "b") setScreen({ name: "form", error: "" });
      else if (input === "q") onExit(screen.exitCode);
    }
  });

  if (screen.name === "form") {
    return <SetupForm values={values} error={screen.error} onChange={setValues} onSubmit={() => void loadPlan()} />;
  }

  if (screen.name === "loading") {
    return <Text>{screen.message}</Text>;
  }

  if (screen.name === "weights") {
    const group = screen.prompts[screen.step]!;
    return (
      <WeightMenu
        group={group}
        profiles={screen.profiles}
        items={weightItems(group, screen.profiles, sourceName)}
        cursor={screen.cursor}
        step={screen.step}
        steps={screen.prompts.length}
        sourceName={sourceName}
        warnings={weightWarnings}
      />
    );
  }

  if (screen.name === "pick") {
    return <Picker catalogSize={catalog?.profiles.length ?? 0} matches={matches} state={picker} warnings={catalog?.warnings ?? []} />;
  }

  if (screen.name === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {screen.message}</Text>
        <Text dimColor>[b] back to settings · [q] quit</Text>
      </Box>
    );
  }

  const target = connection(values);
  const failed = screen.name === "done" ? screen.results.filter(resultFailed) : [];

  return (
    <Box flexDirection="column">
      <Text bold>
        {screen.profiles.length} profiles from {values.source}
      </Text>
      <Text>
        Presets → {bambuBaseFilamentDir(values.presetFolder.trim())} for {printers(values).join(", ")} (
        {values.overwritePresets ? "existing presets replaced" : "existing presets kept"})
      </Text>
      <Text>
        SpoolEase:{" "}
        {target
          ? `${target.https ? "https" : "http"}://${target.host}:${target.port} (${values.createSpools ? "register filaments + create spools" : "register filaments only"})`
          : "skipped"}
      </Text>
      <Box marginY={1}>
        <PlanTable
          profiles={screen.profiles}
          progress={progress}
          activePresets={stage === "presets"}
          activeSpools={stage === "spools"}
        />
      </Box>
      {stage ? <Text color="cyan">{STAGE_LABELS[stage]}…</Text> : null}
      {[...weightWarnings, ...warnings].map((w) => (
        <Text key={w} color="yellow">
          ! {w}
        </Text>
      ))}
      {screen.name === "plan" ? <Text dimColor>[a] apply · [b] back to settings · [q] quit</Text> : null}
      {screen.name === "done" ? (
        <Box flexDirection="column">
          <Text bold color={failed.length ? "red" : "green"}>
            Done: {screen.results.length - failed.length} written, {failed.length} failed
          </Text>
          {failed.map((r) => (
            <Text key={r.profileName} color="red">
              ✗ {r.profileName}: {r.detail}
            </Text>
          ))}
          <Text dimColor>[q] quit</Text>
        </Box>
      ) : null}
    </Box>
  );
}
