// ABOUTME: Root TUI component: start menu → (settings) → (SpoolmanDB browser or search) → plan → live apply → summary (→ labels).
// ABOUTME: Runs the shared sync orchestration and reports the process exit code via onExit.

import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import { errorMessage } from "../errors.js";
import { type LabelTarget, makeLabels } from "../labelJob.js";
import { listPrinters } from "../labelPdf.js";
import { loadLabelSettings, saveLabelSettings } from "../labelSettings.js";
import { type FilamentProfile, resultFailed, type SyncResult } from "../models.js";
import { bambuBaseFilamentDir } from "../paths.js";
import { loadProfiles } from "../sources.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../spoolease.js";
import { type Catalog, filterProfiles, loadSpoolmanDb, SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import { applyWeights, readSpoolWeights, type WeightChoice, type WeightGroup, weightGroups } from "../spoolWeights.js";
import { checkKey, KeyCheckError, runSync, SetupError, type SyncEvent, type SyncStage } from "../sync.js";
import { saveTuiSettings } from "../tuiSettings.js";
import { Browse, browseInput, initialBrowseState } from "./Browse.js";
import { HomeMenu, homeInput, homeItems, initialHomeCursor } from "./HomeMenu.js";
import { initialPickerState, Picker, pickerInput } from "./Picker.js";
import { PlanTable, type RowProgress } from "./PlanTable.js";
import { SetupForm } from "./SetupForm.js";
import { initialLabelForm, LabelForm, type LabelFormState, labelFormInput, labelFormSettings, labelFormTarget } from "./LabelForm.js";
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
  | { name: "home"; cursor: number }
  | { name: "form"; error: string }
  | { name: "loading"; message: string }
  | { name: "browse" }
  | { name: "pick" }
  /** One menu per brand in prompts; groups covers every brand, including those decided without asking. */
  | { name: "weights"; profiles: FilamentProfile[]; groups: WeightGroup[]; prompts: WeightGroup[]; step: number; cursor: number }
  | { name: "plan"; profiles: FilamentProfile[] }
  | { name: "running"; profiles: FilamentProfile[] }
  | { name: "done"; profiles: FilamentProfile[]; results: SyncResult[] }
  | { name: "labels"; profiles: FilamentProfile[]; results: SyncResult[]; form: LabelFormState }
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

/** IDs of the spools a run created, in profile order. */
function newSpoolIds(results: SyncResult[]): string[] {
  return results.map((r) => r.spoolId).filter((id): id is string => Boolean(id));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
  const [screen, setScreen] = useState<Screen>(() => ({ name: "home", cursor: initialHomeCursor(homeItems(initial.source)) }));
  // The source of the current run: SpoolmanDB or the file/URL from the settings, which stays on the menu.
  const [activeSource, setActiveSource] = useState(initial.source.trim());
  const [progress, setProgress] = useState<RowProgress[]>([]);
  const [stage, setStage] = useState<SyncStage | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [picker, setPicker] = useState(() => initialPickerState(initial.query));
  // The browser shares the picker's selection; chooser is where b and esc return to from the weights and plan.
  const [browse, setBrowse] = useState(initialBrowseState);
  const [chooser, setChooser] = useState<"browse" | "pick">("browse");
  // Empty spool weight per brand key; kept while going back and forth so earlier picks stay selected.
  const [weightChoices, setWeightChoices] = useState<ReadonlyMap<string, WeightChoice>>(new Map());
  const [weightWarnings, setWeightWarnings] = useState<string[]>([]);
  // Outcome of the last labels made from the summary.
  const [labelsDone, setLabelsDone] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const matches = useMemo(
    () => (catalog ? filterProfiles(catalog.profiles, { brand: "", material: "", match: picker.query }) : []),
    [catalog, picker.query],
  );
  const fromSpoolmanDb = activeSource === SPOOLMANDB_SOURCE;
  const sourceName = fromSpoolmanDb ? "SpoolmanDB" : "Source file";

  function showPlan(profiles: FilamentProfile[]): void {
    setProgress([]);
    setScreen({ name: "plan", profiles });
  }

  function back(): void {
    if (!fromSpoolmanDb || !catalog) setScreen({ name: "form", error: "" });
    else setScreen(chooser === "pick" ? { name: "pick" } : { name: "browse" });
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

  function home(): void {
    setScreen({ name: "home", cursor: initialHomeCursor(homeItems(values.source)) });
  }

  async function loadPlan(source: string): Promise<void> {
    const error = validate({ ...values, source });
    if (error) {
      setScreen({ name: "form", error });
      return;
    }
    const spoolmanDb = source.trim() === SPOOLMANDB_SOURCE;
    setActiveSource(source.trim());
    setScreen({ name: "loading", message: spoolmanDb ? "Loading SpoolmanDB…" : `Loading profiles from ${source}…` });
    try {
      if (spoolmanDb) {
        setCatalog(await loadSpoolmanDb({ diameter: values.diameter }));
        // A search given on the command line (--brand/--material/--match) opens the name search.
        setScreen(picker.query ? { name: "pick" } : { name: "browse" });
        return;
      }
      const profiles = await loadProfiles(source.trim());
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
      await saveTuiSettings({ printers: printers(values) });
    } catch (err) {
      setWarnings((w) => [...w, `Couldn't remember these printers: ${errorMessage(err)}`]);
    }
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

  async function openLabels(profiles: FilamentProfile[], results: SyncResult[]): Promise<void> {
    setScreen({ name: "loading", message: "Looking for printers…" });
    const [saved, printerList] = await Promise.all([loadLabelSettings(), listPrinters()]);
    setScreen({ name: "labels", profiles, results, form: initialLabelForm(saved, printerList) });
  }

  async function printLabels(profiles: FilamentProfile[], results: SyncResult[], form: LabelFormState, target: LabelTarget): Promise<void> {
    const spoolease = connection(values);
    setScreen({ name: "loading", message: "Making labels…" });
    const lines: string[] = [];
    let ok = true;
    try {
      if (!spoolease) throw new Error("SpoolEase is skipped");
      const ids = newSpoolIds(results);
      const made = await makeLabels(new SpoolEaseClient(spoolease), { ids, brand: "", material: "", match: "" }, target, (w) => lines.push(w));
      const count = plural(made.spools.length, "label");
      if (target.output) lines.push(`Wrote ${count} to ${target.output}`);
      if (made.printError) {
        ok = false;
        lines.push(made.printError);
      } else if (target.printer) {
        lines.push(`Sent ${count} to ${target.printer}${made.printReply ? `: ${made.printReply}` : ""}`);
      }
    } catch (err) {
      ok = false;
      lines.push(`Labels failed: ${errorMessage(err)}`);
    }
    try {
      await saveLabelSettings(labelFormSettings(form));
    } catch (err) {
      lines.push(`Couldn't remember these label choices: ${errorMessage(err)}`);
    }
    setLabelsDone({ ok, lines });
    setScreen({ name: "done", profiles, results });
  }

  // Always subscribed: toggling isActive re-attaches Ink's listener in an effect after the
  // new screen renders, so a key pressed right after "Done" appears could be dropped.
  useInput((input, key) => {
    if (screen.name === "home") {
      const items = homeItems(values.source);
      const action = homeInput(screen.cursor, input, key, items);
      if (action.type === "move") setScreen({ name: "home", cursor: action.cursor });
      else if (action.type === "choose") {
        if (action.id === "spoolmandb") void loadPlan(SPOOLMANDB_SOURCE);
        else if (action.id === "import") void loadPlan(values.source);
        else if (action.id === "settings") setScreen({ name: "form", error: "" });
        else onExit(0);
      }
    } else if (screen.name === "browse") {
      if (!catalog) return;
      const action = browseInput(browse, input, key, catalog.profiles, picker.selected);
      if (action.type === "update") {
        setBrowse(action.state);
        if (action.selected) setPicker({ ...picker, selected: action.selected });
      } else if (action.type === "search") setScreen({ name: "pick" });
      else if (action.type === "back") home();
      else if (action.type === "done") {
        setPicker({ ...picker, selected: action.selected });
        setChooser("browse");
        void chooseWeights(catalog.profiles.filter((p) => action.selected.has(p.filamentId)));
      }
    } else if (screen.name === "pick") {
      const action = pickerInput(picker, input, key, matches);
      if (action.type === "update") setPicker(action.state);
      else if (action.type === "back") setScreen({ name: "browse" });
      else if (catalog) {
        setChooser("pick");
        void chooseWeights(catalog.profiles.filter((p) => picker.selected.has(p.filamentId)));
      }
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
      else if (input === "l" && newSpoolIds(screen.results).length > 0) void openLabels(screen.profiles, screen.results);
    } else if (screen.name === "labels") {
      const action = labelFormInput(screen.form, input, key);
      if (action.type === "update") setScreen({ ...screen, form: action.state });
      else if (action.type === "back") setScreen({ name: "done", profiles: screen.profiles, results: screen.results });
      else {
        const checked = labelFormTarget(screen.form);
        if ("error" in checked) setScreen({ ...screen, form: { ...screen.form, error: checked.error } });
        else void printLabels(screen.profiles, screen.results, screen.form, checked.target);
      }
    } else if (screen.name === "error") {
      if (input === "b") setScreen({ name: "form", error: "" });
      else if (input === "q") onExit(screen.exitCode);
    }
  });

  if (screen.name === "home") {
    const target = connection(values);
    const context = [
      `BambuStudio: ${values.presetFolder.trim()} · ${printers(values).join(", ")}`,
      `SpoolEase: ${target ? `${target.host}${values.createSpools ? "" : " (register filaments only)"}` : "skipped"}`,
    ];
    return <HomeMenu items={homeItems(values.source)} cursor={screen.cursor} context={context} />;
  }

  if (screen.name === "form") {
    return <SetupForm values={values} error={screen.error} onChange={setValues} onSubmit={() => void loadPlan(values.source)} onBack={home} />;
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

  if (screen.name === "browse") {
    return <Browse state={browse} profiles={catalog?.profiles ?? []} selected={picker.selected} warnings={catalog?.warnings ?? []} />;
  }

  if (screen.name === "pick") {
    return <Picker catalogSize={catalog?.profiles.length ?? 0} matches={matches} state={picker} warnings={catalog?.warnings ?? []} />;
  }

  if (screen.name === "labels") {
    return <LabelForm state={screen.form} spoolIds={newSpoolIds(screen.results)} />;
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
  const created = screen.name === "done" ? newSpoolIds(screen.results).length : 0;

  return (
    <Box flexDirection="column">
      <Text bold>
        {plural(screen.profiles.length, "profile")} from {activeSource}
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
      {screen.name === "plan" ? (
        <Text dimColor>[a] apply · [b] back to {fromSpoolmanDb && catalog ? "filaments" : "settings"} · [q] quit</Text>
      ) : null}
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
          {labelsDone?.lines.map((line) => (
            <Text key={line} color={labelsDone.ok ? "green" : "red"}>
              {labelsDone.ok ? "✓" : "✗"} {line}
            </Text>
          ))}
          <Text dimColor>{created > 0 ? `[l] labels for ${plural(created, "new spool")} · [q] quit` : "[q] quit"}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
