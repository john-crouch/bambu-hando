// ABOUTME: Root TUI component: start menu → (settings) → (SpoolmanDB browser or search) → plan → live apply → summary (→ labels).
// ABOUTME: Runs the shared sync orchestration and reports the process exit code via onExit.

import { readdir } from "node:fs/promises";
import { basename } from "node:path";

import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import { SystemProfiles } from "../bambuProfiles.js";
import { errorMessage } from "../errors.js";
import { type LabelTarget, makeLabels } from "../labelJob.js";
import { listPrinters } from "../labelPdf.js";
import { loadLabelSettings, saveLabelSettings } from "../labelSettings.js";
import { type FilamentProfile, resultFailed, type SyncResult } from "../models.js";
import { bambuBaseFilamentDir, bambuConfigDir, bambuUserRoot, tildePath } from "../paths.js";
import { loadProfiles } from "../sources.js";
import { SpoolEaseClient, type SpoolEaseConnection, type SpoolEaseWrite } from "../spoolease.js";
import { addSpoolCopies, type CopyableFilament, copyableFilaments } from "../spoolCopies.js";
import { type CheckSection, checkSync, readUserPresets } from "../syncCheck.js";
import { type Catalog, filterProfiles, loadSpoolmanDb, SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import { applyWeights, readSpoolWeights, type WeightChoice, type WeightGroup, weightGroups } from "../spoolWeights.js";
import { checkKey, KeyCheckError, runSync, SetupError, type SyncEvent, type SyncStage } from "../sync.js";
import { saveTuiSettings } from "../tuiSettings.js";
import { Browse, browseInput, browseRows, initialBrowseState } from "./Browse.js";
import { type ChoiceItem, ChoiceList, choiceInput, type ChoiceState, initialChoiceState } from "./ChoiceList.js";
import { HomeMenu, homeInput, homeItems, initialHomeCursor } from "./HomeMenu.js";
import { initialPickerState, Picker, pickerInput } from "./Picker.js";
import { PlanTable, type RowProgress } from "./PlanTable.js";
import { type ChoiceKey, connectionOpen, SetupForm } from "./SetupForm.js";
import { ColorForm, colorFormInput, colorFormProfile, type ColorFormState, initialColorForm } from "./ColorForm.js";
import { SpoolCopies } from "./SpoolCopies.js";
import { checkInput, checkLines, SyncCheck } from "./SyncCheck.js";
import {
  initialLabelForm,
  LabelForm,
  type LabelFormState,
  labelFormInput,
  labelFormSettings,
  labelFormTarget,
  labelPrinterItems,
  labelSizeItems,
} from "./LabelForm.js";
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
  /** A list opened from settings or the label screen; onDone and onCancel return to it. */
  | { name: "choose"; title: string; items: ChoiceItem[]; multi: boolean; state: ChoiceState; onDone: (values: string[]) => void; onCancel: () => void }
  | { name: "loading"; message: string }
  | { name: "browse" }
  | { name: "pick" }
  /** A color the catalog doesn't list, for the brand and material open in the browser. */
  | { name: "color"; form: ColorFormState }
  /** One menu per brand in prompts; groups covers every brand, including those decided without asking. */
  | { name: "weights"; profiles: FilamentProfile[]; groups: WeightGroup[]; prompts: WeightGroup[]; step: number; cursor: number }
  | { name: "plan"; profiles: FilamentProfile[] }
  | { name: "running"; profiles: FilamentProfile[] }
  | { name: "done"; profiles: FilamentProfile[]; results: SyncResult[] }
  /** More spools of a filament the console has: results is null until applied, then fills in one copy at a time. */
  | { name: "copies"; filaments: CopyableFilament[]; filament: CopyableFilament; count: number; results: SpoolEaseWrite[] | null; running: boolean }
  /** Labels for spoolIds; back is the screen esc and making the labels return to (the summary or the menu). */
  | { name: "labels"; spoolIds: string[]; fresh: boolean; form: LabelFormState; back: Screen }
  /** The read-only sync check; top is the first report line on screen. */
  | { name: "check"; sections: CheckSection[]; warnings: string[]; top: number }
  | { name: "error"; message: string; exitCode: number };

/** How many copies the count list offers. */
const MAX_COPIES = 8;

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
  const [screen, setScreen] = useState<Screen>(() => ({ name: "home", cursor: initialHomeCursor(homeItems(initial.source, !initial.skipSpoolease)) }));
  // The source of the current run: SpoolmanDB or the file/URL from the settings, which stays on the menu.
  const [activeSource, setActiveSource] = useState(initial.source.trim());
  const [formFocus, setFormFocus] = useState(0);
  const [connectionRequested, setConnectionRequested] = useState(false);
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
  // What the last run, copies or labels did, shown on the screen they return to.
  const [outcome, setOutcome] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const matches = useMemo(
    () => (catalog ? filterProfiles(catalog.profiles, { brand: "", material: "", match: picker.query }) : []),
    [catalog, picker.query],
  );
  // A failed run keeps the exit code at 1 even when quitting later from the menu.
  const [runFailed, setRunFailed] = useState(false);
  const fromSpoolmanDb = activeSource === SPOOLMANDB_SOURCE;
  const sourceName = fromSpoolmanDb ? "SpoolmanDB" : "Source file";

  function showPlan(profiles: FilamentProfile[]): void {
    setProgress([]);
    setScreen({ name: "plan", profiles });
  }

  function back(): void {
    if (!fromSpoolmanDb || !catalog) home();
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

  function menuItems() {
    return homeItems(values.source, connection(values) !== null);
  }

  function home(): void {
    setScreen({ name: "home", cursor: initialHomeCursor(menuItems()) });
  }

  /** BambuStudio's user folders, or its instantiable printers, as a list to choose from. */
  async function openChoice(field: ChoiceKey): Promise<void> {
    setScreen({ name: "loading", message: field === "presetFolder" ? "Reading BambuStudio folders…" : "Reading BambuStudio printers…" });
    try {
      let items: ChoiceItem[];
      let current: string[];
      if (field === "presetFolder") {
        const entries = await readdir(bambuUserRoot(), { withFileTypes: true }).catch(() => []);
        current = [values.presetFolder.trim()];
        const names = new Set([...entries.filter((e) => e.isDirectory()).map((e) => e.name), ...current.filter(Boolean)]);
        items = [...names].sort().map((name) => ({ value: name, label: name, detail: name === "default" ? "used when not logged in to BambuStudio" : "" }));
      } else {
        const known = (await SystemProfiles.load(bambuConfigDir())).printers();
        current = printers(values);
        const unknown = current.filter((p) => !known.includes(p));
        items = [
          ...known.map((name) => ({ value: name, label: name.replace(/^Bambu Lab /, "") })),
          ...unknown.map((name) => ({ value: name, label: name, detail: "not in BambuStudio's printers" })),
        ];
      }
      const multi = field === "printerPreset";
      const title = multi ? "Printers to write presets for" : "BambuStudio preset folder";
      const toForm = (): void => setScreen({ name: "form", error: "" });
      setScreen({
        name: "choose",
        title,
        items,
        multi,
        state: initialChoiceState(items, current),
        onDone: (chosen) => {
          setValues({ ...values, [field]: chosen.join(", ") });
          toForm();
        },
        onCancel: toForm,
      });
    } catch (err) {
      setScreen({ name: "form", error: errorMessage(err) });
    }
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
    setOutcome(null);
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
      if (results.some(resultFailed)) setRunFailed(true);
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

  async function openLabels(spoolIds: string[], fresh: boolean, back: Screen): Promise<void> {
    setScreen({ name: "loading", message: "Looking for printers…" });
    const [saved, printerList] = await Promise.all([loadLabelSettings(), listPrinters()]);
    setScreen({ name: "labels", spoolIds, fresh, back, form: initialLabelForm(saved, printerList) });
  }

  /** The console's spools, newest first, to tick the ones to label. */
  async function openSpoolLabels(): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    setScreen({ name: "loading", message: "Reading spools from SpoolEase…" });
    const backHome: Screen = { name: "home", cursor: initialHomeCursor(menuItems()) };
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const spools = await client.listSpools();
      if (spools.length === 0) {
        setOutcome({ ok: false, lines: ["The SpoolEase console has no spools yet"] });
        setScreen(backHome);
        return;
      }
      const items = [...spools]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((spool) => ({ value: spool.id, label: `#${spool.id} ${[spool.brand, spool.material, spool.colorName].filter(Boolean).join(" ")}` }));
      setScreen({
        name: "choose",
        title: "Spools to label",
        items,
        multi: true,
        state: initialChoiceState(items, []),
        onDone: (ids) => void openLabels(ids, false, backHome),
        onCancel: () => setScreen(backHome),
      });
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't read the spools: ${errorMessage(err)}`] });
      setScreen(backHome);
    }
  }

  /** Filaments with spools on the console, to add more spools of one. */
  async function openMoreSpools(): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    setScreen({ name: "loading", message: "Reading spools from SpoolEase…" });
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const spools = await client.listSpools();
      // Names only make the list nicer; spools carry everything a copy needs.
      const names = await client.getCustomFilaments().catch(() => new Map());
      const filaments = copyableFilaments(spools, names);
      if (filaments.length === 0) {
        setOutcome({ ok: false, lines: ["No spool on the console has a filament code to copy"] });
        home();
        return;
      }
      chooseCopyFilament(filaments, null);
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't read the spools: ${errorMessage(err)}`] });
      home();
    }
  }

  function chooseCopyFilament(filaments: CopyableFilament[], current: string | null): void {
    const items = filaments.map((f) => ({ value: f.code, label: f.name, detail: plural(f.count, "spool") }));
    setScreen({
      name: "choose",
      title: "Which filament? (more spools of one you have)",
      items,
      multi: false,
      state: initialChoiceState(items, current ? [current] : []),
      onDone: ([code]) => chooseCopyCount(filaments, filaments.find((f) => f.code === code)!, 1),
      onCancel: home,
    });
  }

  function chooseCopyCount(filaments: CopyableFilament[], filament: CopyableFilament, current: number): void {
    const items = Array.from({ length: MAX_COPIES }, (_, i) => ({ value: String(i + 1), label: plural(i + 1, "spool") }));
    setScreen({
      name: "choose",
      title: `How many new spools of ${filament.name}?`,
      items,
      multi: false,
      state: initialChoiceState(items, [String(current)]),
      onDone: ([count]) => setScreen({ name: "copies", filaments, filament, count: Number(count), results: null, running: false }),
      onCancel: () => chooseCopyFilament(filaments, filament.code),
    });
  }

  async function addCopies(filament: CopyableFilament, count: number): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    const update = (changes: { results?: SpoolEaseWrite[]; running?: boolean }) =>
      setScreen((s) => (s.name === "copies" ? { ...s, ...changes } : s));
    update({ results: [], running: true });
    const results: SpoolEaseWrite[] = [];
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      await addSpoolCopies(client, filament, count, (_, result) => {
        results.push(result);
        update({ results: [...results] });
      });
    } catch (err) {
      results.push({ ok: false, error: errorMessage(err) });
    }
    if (results.some((r) => !r.ok)) setRunFailed(true);
    update({ results: [...results], running: false });
  }

  /** Compare the preset folder's presets with the console's custom filaments and spools; writes nothing. */
  async function openCheck(): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    setScreen({ name: "loading", message: "Comparing BambuStudio presets with SpoolEase…" });
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const [{ presets, warnings }, csv, spools] = await Promise.all([
        readUserPresets(values.presetFolder.trim()),
        client.getCustomFilamentsCsv(),
        client.listSpools(),
      ]);
      setScreen({ name: "check", sections: checkSync({ presets, csv, spools }), warnings, top: 0 });
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't check: ${errorMessage(err)}`] });
      home();
    }
  }

  /** Back to the menu after a run, saying what it did; the next run starts with nothing selected. */
  function finishRun(profiles: FilamentProfile[], results: SyncResult[]): void {
    const failed = results.filter(resultFailed).length;
    const created = newSpoolIds(results).length;
    const source = fromSpoolmanDb ? activeSource : basename(activeSource);
    const spools = created > 0 ? `, ${plural(created, "new spool")}` : "";
    setOutcome({ ok: failed === 0, lines: [`${plural(profiles.length, "profile")} from ${source}: ${results.length - failed} written, ${failed} failed${spools}`] });
    setPicker({ ...picker, selected: new Set() });
    setWeightChoices(new Map());
    setScreen({ name: "home", cursor: initialHomeCursor(menuItems()) });
  }

  async function printLabels(spoolIds: string[], back: Screen, form: LabelFormState, target: LabelTarget): Promise<void> {
    const spoolease = connection(values);
    setScreen({ name: "loading", message: "Making labels…" });
    const lines: string[] = [];
    let ok = true;
    try {
      if (!spoolease) throw new Error("SpoolEase is skipped");
      const made = await makeLabels(new SpoolEaseClient(spoolease), { ids: spoolIds, brand: "", material: "", match: "" }, target, (w) => lines.push(w));
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
    setOutcome({ ok, lines });
    setScreen(back);
  }

  // Always subscribed: toggling isActive re-attaches Ink's listener in an effect after the
  // new screen renders, so a key pressed right after "Done" appears could be dropped.
  useInput((input, key) => {
    if (screen.name === "home") {
      const items = menuItems();
      const action = homeInput(screen.cursor, input, key, items);
      if (action.type === "move") setScreen({ name: "home", cursor: action.cursor });
      else if (action.type === "choose") {
        if (action.id === "spoolmandb") void loadPlan(SPOOLMANDB_SOURCE);
        else if (action.id === "import") void loadPlan(values.source);
        else if (action.id === "more") void openMoreSpools();
        else if (action.id === "labels") void openSpoolLabels();
        else if (action.id === "check") void openCheck();
        else if (action.id === "settings") setScreen({ name: "form", error: "" });
        else onExit(runFailed ? 1 : 0);
      }
    } else if (screen.name === "choose") {
      const action = choiceInput(screen.state, input, key, screen.items, screen.multi);
      if (action.type === "update") setScreen({ ...screen, state: action.state });
      else if (action.type === "cancel") screen.onCancel();
      else if (action.type === "done") screen.onDone(action.values);
    } else if (screen.name === "browse") {
      if (!catalog) return;
      const action = browseInput(browse, input, key, catalog.profiles, picker.selected);
      if (action.type === "update") {
        setBrowse(action.state);
        if (action.selected) setPicker({ ...picker, selected: action.selected });
      } else if (action.type === "search") setScreen({ name: "pick" });
      else if (action.type === "other") setScreen({ name: "color", form: initialColorForm() });
      else if (action.type === "back") home();
      else if (action.type === "done") {
        setPicker({ ...picker, selected: action.selected });
        setChooser("browse");
        void chooseWeights(catalog.profiles.filter((p) => action.selected.has(p.filamentId)));
      }
    } else if (screen.name === "color") {
      if (!catalog) return;
      const action = colorFormInput(screen.form, input, key);
      if (action.type === "update") setScreen({ ...screen, form: action.state });
      else if (action.type === "back") setScreen({ name: "browse" });
      else if (action.type === "choose") {
        const form = screen.form;
        const listed = browseRows(browse, catalog.profiles, picker.selected).flatMap((r) => (r.kind === "product" ? [r.profile] : []));
        const items = listed.map((p) => ({
          value: p.filamentId,
          label: p.colorName,
          detail: `${p.nozzleTempMin}-${p.nozzleTempMax} °C · ${p.labelWeight} g`,
          swatch: `#${p.colorRgba.slice(0, 6)}`,
        }));
        setScreen({
          name: "choose",
          title: `Which listed ${browse.brand} ${browse.material} color has the same settings?`,
          items,
          multi: false,
          state: initialChoiceState(items, form.base ? [form.base.filamentId] : []),
          onDone: ([id]) => setScreen({ name: "color", form: { ...form, base: listed.find((p) => p.filamentId === id) ?? null, cursor: form.base ? form.cursor : form.cursor + 1 } }),
          onCancel: () => setScreen({ name: "color", form }),
        });
      } else {
        const made = colorFormProfile(screen.form, catalog.profiles);
        if ("error" in made) setScreen({ ...screen, form: { ...screen.form, error: made.error } });
        else {
          // The new color joins the catalog for this session, ticked, so it goes on like any listed color.
          const profiles = [...catalog.profiles, made.profile];
          const selected = new Set(picker.selected).add(made.profile.filamentId);
          const cursor = browseRows(browse, profiles, selected).findIndex((r) => r.kind === "product" && r.profile.filamentId === made.profile.filamentId);
          setCatalog({ ...catalog, profiles });
          setPicker({ ...picker, selected });
          setBrowse({ ...browse, cursor });
          setScreen({ name: "browse" });
        }
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
      else if (input === "l" && newSpoolIds(screen.results).length > 0) void openLabels(newSpoolIds(screen.results), true, screen);
      else if (input === "m") finishRun(screen.profiles, screen.results);
    } else if (screen.name === "copies") {
      if (screen.running) return;
      const created = (screen.results ?? []).flatMap((r) => (r.ok ? [r.id] : []));
      if (input === "q") onExit(screen.results?.some((r) => !r.ok) ? 1 : 0);
      else if (screen.results === null) {
        if (input === "a") void addCopies(screen.filament, screen.count);
        else if (input === "b") chooseCopyCount(screen.filaments, screen.filament, screen.count);
      } else if (input === "l" && created.length > 0) void openLabels(created, true, screen);
      else if (input === "m") {
        const failed = (screen.results ?? []).length - created.length;
        setOutcome({ ok: failed === 0, lines: [`${plural(created.length, "spool")} of ${screen.filament.name} added${failed ? `, ${failed} failed` : ""}`] });
        home();
      }
    } else if (screen.name === "labels") {
      const action = labelFormInput(screen.form, input, key);
      if (action.type === "update") setScreen({ ...screen, form: action.state });
      else if (action.type === "choose") {
        const labels = screen;
        const size = action.list === "size";
        const items = size ? labelSizeItems(labels.form.size) : labelPrinterItems(labels.form.printers);
        const current = size ? labels.form.size : labels.form.printer;
        setScreen({
          name: "choose",
          title: size ? "Label size" : "Print with",
          items,
          multi: false,
          state: initialChoiceState(items, [current]),
          onDone: ([value = ""]) => setScreen({ ...labels, form: { ...labels.form, [size ? "size" : "printer"]: value } }),
          onCancel: () => setScreen(labels),
        });
      } else if (action.type === "back") setScreen(screen.back);
      else {
        const checked = labelFormTarget(screen.form);
        if ("error" in checked) setScreen({ ...screen, form: { ...screen.form, error: checked.error } });
        else void printLabels(screen.spoolIds, screen.back, screen.form, checked.target);
      }
    } else if (screen.name === "check") {
      const action = checkInput(screen.top, input, key, checkLines(screen.sections).length);
      if (action.type === "scroll") setScreen({ ...screen, top: action.top });
      else if (action.type === "back") home();
      else if (action.type === "again") void openCheck();
      else if (action.type === "quit") onExit(0);
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
    return <HomeMenu items={menuItems()} cursor={screen.cursor} context={context} outcome={outcome} />;
  }

  if (screen.name === "form") {
    return (
      <SetupForm
        values={values}
        error={screen.error}
        focus={formFocus}
        onFocus={setFormFocus}
        connection={connectionOpen(values, connectionRequested)}
        onConnection={() => setConnectionRequested(!connectionRequested)}
        onChange={setValues}
        onChoose={(field) => void openChoice(field)}
        onBack={home}
      />
    );
  }

  if (screen.name === "choose") {
    return <ChoiceList title={screen.title} items={screen.items} state={screen.state} multi={screen.multi} />;
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

  if (screen.name === "color") {
    return <ColorForm state={screen.form} brand={browse.brand ?? ""} material={browse.material ?? ""} />;
  }

  if (screen.name === "pick") {
    return <Picker catalogSize={catalog?.profiles.length ?? 0} matches={matches} state={picker} warnings={catalog?.warnings ?? []} />;
  }

  if (screen.name === "copies") {
    const target = connection(values);
    return (
      <SpoolCopies
        filament={screen.filament}
        count={screen.count}
        target={target ? `${target.https ? "https" : "http"}://${target.host}:${target.port}` : "skipped"}
        results={screen.results}
        running={screen.running}
        outcome={outcome}
      />
    );
  }

  if (screen.name === "check") {
    const target = connection(values);
    const compared = `BambuStudio ${values.presetFolder.trim()} · SpoolEase ${target ? `${target.host}:${target.port}` : "skipped"}`;
    return <SyncCheck sections={screen.sections} top={screen.top} compared={compared} warnings={screen.warnings} />;
  }

  if (screen.name === "labels") {
    return <LabelForm state={screen.form} spoolIds={screen.spoolIds} fresh={screen.fresh} />;
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
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {"Presets:   "}
          {tildePath(bambuBaseFilamentDir(values.presetFolder.trim()))} · {values.overwritePresets ? "existing presets replaced" : "existing presets kept"}
        </Text>
        <Text>
          {"Printers:  "}
          {printers(values).join(", ")}
        </Text>
        <Text>
          {"SpoolEase: "}
          {target
            ? `${target.https ? "https" : "http"}://${target.host}:${target.port} · ${values.createSpools ? "register filaments + create spools" : "register filaments only"}`
            : "skipped"}
        </Text>
      </Box>
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
        <Text dimColor>[a] apply · [b] back to {fromSpoolmanDb && catalog ? "filaments" : "menu"} · [q] quit</Text>
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
          {outcome?.lines.map((line) => (
            <Text key={line} color={outcome.ok ? "green" : "red"}>
              {outcome.ok ? "✓" : "✗"} {line}
            </Text>
          ))}
          <Text dimColor>{created > 0 ? `[l] labels for ${plural(created, "new spool")} · [m] menu · [q] quit` : "[m] menu · [q] quit"}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
