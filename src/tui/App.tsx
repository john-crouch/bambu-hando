// ABOUTME: Root TUI component: start menu → (settings) → (SpoolmanDB browser or search) → plan → live apply → summary (→ labels).
// ABOUTME: Runs the shared sync orchestration and reports the process exit code via onExit.

import { access, readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";

import { StatusMessage } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { SystemProfiles } from "../bambuProfiles.js";
import { buildPreset, presetPath } from "../bambuStudio.js";
import {
  type BarcodeFilament,
  loadBarcodes,
  normalizeBarcode,
  rememberBarcode,
} from "../barcodes.js";
import { errorMessage } from "../errors.js";
import { type LabelTarget, makeLabels } from "../labelJob.js";
import { listPrinters } from "../labelPdf.js";
import { loadLabelSettings, saveLabelSettings } from "../labelSettings.js";
import { type FilamentProfile, resultFailed, type SyncResult } from "../models.js";
import { bambuBaseFilamentDir, bambuConfigDir, bambuUserRoot, tildePath } from "../paths.js";
import { type ConsoleState, type ProfilePlan, previewPlan } from "../planPreview.js";
import {
  applyEdits,
  type EditResult,
  type Edits,
  type EditValue,
  editChanges,
  nozzleRange,
  type Preset,
  presetFamily,
  rangeError,
  writePresetEdits,
} from "../presetEdit.js";
import { fixPresetIds, type IdFix, type IdFixResult, idFixes } from "../presetIds.js";
import { loadProfiles } from "../sources.js";
import { addSpoolCopies, type CopyableFilament, copyableFilaments } from "../spoolCopies.js";
import {
  type CustomFilament,
  SpoolEaseClient,
  type SpoolEaseConnection,
  type SpoolEaseWrite,
  type SpoolRecord,
  withNozzleRange,
} from "../spoolease.js";
import { inventoryRows } from "../spoolInventory.js";
import { type Catalog, filterProfiles, loadSpoolmanDb, SPOOLMANDB_SOURCE } from "../spoolmanDb.js";
import {
  applyWeights,
  readSpoolWeights,
  type WeightChoice,
  type WeightGroup,
  weightGroups,
} from "../spoolWeights.js";
import {
  checkKey,
  KeyCheckError,
  runSync,
  SetupError,
  type SyncEvent,
  type SyncStage,
} from "../sync.js";
import {
  type CheckSection,
  checkLines,
  readCheck,
  readUserPresets,
  type UserPreset,
} from "../syncCheck.js";
import { saveTuiSettings } from "../tuiSettings.js";
import { BarcodeScan, scanInput } from "./BarcodeScan.js";
import { Browse, browseInput, browseListRows, browseRows, initialBrowseState } from "./Browse.js";
import { Busy } from "./Busy.js";
import {
  type ChoiceItem,
  ChoiceList,
  type ChoiceState,
  choiceInput,
  choiceRows,
  initialChoiceState,
} from "./ChoiceList.js";
import {
  ColorForm,
  type ColorFormState,
  colorFormInput,
  colorFormProfile,
  colorFormTyping,
  initialColorForm,
} from "./ColorForm.js";
import { consoleUrl, LinkedText, type TextPart } from "./ConsoleLink.js";
import type { FormValues } from "./core/values.js";
import { Help, type HelpTopic } from "./Help.js";
import { HomeMenu, homeInput, homeItems, initialHomeCursor } from "./HomeMenu.js";
import {
  initialLabelForm,
  LabelForm,
  type LabelFormState,
  labelFormInput,
  labelFormSettings,
  labelFormTarget,
  labelFormTyping,
  labelPrinterItems,
  labelSizeItems,
} from "./LabelForm.js";
import { initialPickerState, Picker, pickerInput, pickerRows } from "./Picker.js";
import { PlanNotes, PlanTable, type RowProgress, RunProgress } from "./PlanTable.js";
import {
  initialPresetForm,
  PresetForm,
  type PresetFormState,
  presetFormInput,
  presetFormRows,
  presetFormTyping,
} from "./PresetForm.js";
import { PresetIds } from "./PresetIds.js";
import {
  initialPresetList,
  PresetList,
  type PresetListState,
  presetListInput,
  presetListRows,
  presetMatches,
} from "./PresetList.js";
import { PresetReview, type RangeChange } from "./PresetReview.js";
import {
  initialRawSettings,
  RawSettings,
  type RawSettingsState,
  rawInput,
  rawKeys,
  rawRows,
  rawTyping,
} from "./RawSettings.js";
import { type ChoiceKey, connectionOpen, formTyping, SetupForm } from "./SetupForm.js";
import { SpoolCopies } from "./SpoolCopies.js";
import {
  initialSpoolList,
  SpoolList,
  type SpoolListState,
  spoolListInput,
  spoolListRows,
} from "./SpoolList.js";
import { checkInput, checkRows, SyncCheck } from "./SyncCheck.js";
import { useTerminalColumns, useTerminalRows } from "./screenSize.js";
import { COLORS } from "./theme.js";
import { itemIndex, WeightMenu, weightInput, weightItems } from "./WeightMenu.js";

export type { FormValues } from "./core/values.js";

type Screen =
  | { name: "home"; cursor: number }
  | { name: "form"; error: string }
  /** A list opened from settings or the label screen; onDone and onCancel return to it. */
  | {
      name: "choose";
      title: string;
      items: ChoiceItem[];
      multi: boolean;
      state: ChoiceState;
      onDone: (values: string[]) => void;
      onCancel: () => void;
    }
  | { name: "loading"; message: string }
  | { name: "browse" }
  | { name: "pick" }
  /** A color the catalog doesn't list, for the brand and material open in the browser. */
  | { name: "color"; form: ColorFormState }
  /** One menu per brand in prompts; groups covers every brand, including those decided without asking. */
  | {
      name: "weights";
      profiles: FilamentProfile[];
      groups: WeightGroup[];
      prompts: WeightGroup[];
      step: number;
      cursor: number;
    }
  | PlanScreen
  | { name: "running"; profiles: FilamentProfile[]; plans: ProfilePlan[] | null }
  | {
      name: "done";
      profiles: FilamentProfile[];
      plans: ProfilePlan[] | null;
      results: SyncResult[];
    }
  /** More spools of a filament the console has: results is null until applied, then fills in one copy at a time. */
  | {
      name: "copies";
      filaments: CopyableFilament[];
      filament: CopyableFilament;
      count: number;
      results: SpoolEaseWrite[] | null;
      running: boolean;
    }
  /** Labels for spoolIds; back is the screen esc and making the labels return to (the summary or the menu). */
  | { name: "labels"; spoolIds: string[]; fresh: boolean; form: LabelFormState; back: Screen }
  /** The read-only sync check; top is the first report line on screen; fixes, presets [f] can give an ID. */
  | { name: "check"; sections: CheckSection[]; warnings: string[]; top: number; fixes: IdFix[] }
  /** A barcode being scanned or typed; filaments are the console's, barcodes the ones learned so far. */
  | {
      name: "scan";
      code: string;
      error: string;
      filaments: CopyableFilament[];
      barcodes: ReadonlyMap<string, BarcodeFilament>;
    }
  /** The console's spools as an inventory, with the custom-filament names they're listed by. */
  | {
      name: "spools";
      spools: SpoolRecord[];
      names: ReadonlyMap<string, CustomFilament>;
      state: SpoolListState;
    }
  /** Filament IDs for presets without one: results is null until written. */
  | { name: "ids"; fixes: IdFix[]; results: IdFixResult[] | null; running: boolean }
  /** The preset folder's filament presets, to pick one to edit. */
  | PresetsScreen
  | EditScreen
  /** Every key of the preset being edited, as raw text. */
  | { name: "raw"; edit: EditScreen; state: RawSettingsState }
  /** The review of an edit, then its results: results is null until saved. */
  | SaveScreen
  | { name: "error"; message: string; exitCode: number }
  /** The help page for back, which any key returns to. */
  | { name: "help"; topic: HelpTopic; multi: boolean; back: Screen };

/**
 * plans: what the run would do to each profile, null when it couldn't be worked out; warning says why.
 * spoolease: the console as read for the plan, so edits made on it are shown without reading again.
 */
type PlanScreen = {
  name: "plan";
  profiles: FilamentProfile[];
  plans: ProfilePlan[] | null;
  warning: string;
  spoolease: ConsoleState | null;
  error: string;
};
type PresetsScreen = {
  name: "presets";
  presets: UserPreset[];
  warnings: string[];
  state: PresetListState;
};
/**
 * A preset being edited: original is the file as read, or the preset a run would write when opened from the
 * plan; edits what isn't saved (or written) yet; from is where it was opened and goes back to.
 */
type EditScreen = {
  name: "edit";
  from: PresetsScreen | PlanScreen;
  preset: UserPreset;
  original: Preset;
  edits: Edits;
  form: PresetFormState;
};
type SaveScreen = {
  name: "save";
  edit: EditScreen;
  targets: UserPreset[];
  /** SpoolEase's custom filament whose nozzle range changes too; null when it doesn't. */
  spoolease: RangeChange | null;
  warning: string;
  results: EditResult[] | null;
  spooleaseResult: { ok: boolean; line: string } | null;
  running: boolean;
};

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
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return "SpoolEase port must be a number between 1 and 65535";
  return "";
}

function connection(values: FormValues): SpoolEaseConnection | null {
  if (values.skipSpoolease) return null;
  return {
    host: values.host.trim(),
    port: Number(values.port),
    securityKey: values.securityKey,
    https: values.https,
  };
}

/** IDs of the spools a run created, in profile order. */
function newSpoolIds(results: SyncResult[]): string[] {
  return results.map((r) => r.spoolId).filter((id): id is string => Boolean(id));
}

/** A spool's (first) color as "#RRGGBB" for a list swatch. */
function swatchOf(colorCodes: string[]): string | undefined {
  const code = colorCodes[0];
  return code && /^[0-9A-F]{6}/i.test(code) ? `#${code.slice(0, 6)}` : undefined;
}

const STATUS_COLORS = {
  success: COLORS.ok,
  error: COLORS.failed,
  warning: COLORS.warning,
} as const;

/** A status line: StatusMessage's icon, and the whole line in its color, as the TUI's other screens draw them. */
function Status({
  variant,
  children,
}: {
  variant: keyof typeof STATUS_COLORS;
  children: ReactNode;
}) {
  return (
    <StatusMessage variant={variant}>
      <Text color={STATUS_COLORS[variant]}>{children}</Text>
    </StatusMessage>
  );
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
  const [screen, setScreen] = useState<Screen>(() => ({
    name: "home",
    cursor: initialHomeCursor(homeItems(initial.source, !initial.skipSpoolease)),
  }));
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
    () =>
      catalog
        ? filterProfiles(catalog.profiles, { brand: "", material: "", match: picker.query })
        : [],
    [catalog, picker.query],
  );
  // Preset edits not saved yet, by preset file; kept while going back to the list and opening others.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Edits>>(new Map());
  // Edits made on the plan, by filament ID: the next run writes them into its new presets.
  const [planEdits, setPlanEdits] = useState<ReadonlyMap<string, Edits>>(new Map());
  // BambuStudio's system profiles, read the first time a preset is edited on the plan.
  const system = useRef<SystemProfiles | null>(null);
  // A failed run keeps the exit code at 1 even when quitting later from the menu.
  const [runFailed, setRunFailed] = useState(false);
  // Lists grow and shrink with the terminal.
  const height = useTerminalRows();
  const columns = useTerminalColumns();
  const fromSpoolmanDb = activeSource === SPOOLMANDB_SOURCE;
  const sourceName = fromSpoolmanDb ? "SpoolmanDB" : "Source file";

  /** The plan, with what the run would do to each profile's presets, custom filament row and spool; reads only. */
  async function showPlan(profiles: FilamentProfile[]): Promise<void> {
    setProgress([]);
    setScreen({ name: "loading", message: "Comparing with what BambuStudio and SpoolEase have…" });
    const target = connection(values);
    let spoolease: ConsoleState | null = null;
    let warning = "";
    if (target) {
      try {
        const client = new SpoolEaseClient(target);
        await checkKey(client);
        const [csv, spooledIds] = await Promise.all([
          client.getCustomFilamentsCsv(),
          values.createSpools ? client.listSpoolFilamentIds() : Promise.resolve(new Set<string>()),
        ]);
        spoolease = { csv, spooledIds };
      } catch (err) {
        warning = `Couldn't read SpoolEase to show what the run changes there: ${errorMessage(err)}`;
      }
    }
    setScreen(await planScreen(profiles, spoolease, warning, planEdits));
  }

  /** The plan for spoolease as already read; looks again only for presets. */
  async function planScreen(
    profiles: FilamentProfile[],
    spoolease: ConsoleState | null,
    warning: string,
    edits: ReadonlyMap<string, Edits>,
  ): Promise<PlanScreen> {
    const target = { presetFolder: values.presetFolder.trim(), printers: printers(values) };
    const plans = await previewPlan(profiles, target, spoolease, values.createSpools, {
      overwrite: values.overwritePresets,
      edits,
    }).catch((err: unknown) => {
      warning = `Couldn't look for existing presets: ${errorMessage(err)}`;
      return null;
    });
    return { name: "plan", profiles, plans, warning, spoolease, error: "" };
  }

  /** Which filament's presets to edit before the run writes them; straight to the one when there's one. */
  function choosePlanned(plan: PlanScreen): void {
    const only = plan.profiles.length === 1 ? plan.profiles[0] : undefined;
    if (only) {
      void openPlanned(plan, only);
      return;
    }
    const items = plan.profiles.map((p) => {
      const count = planEdits.get(p.filamentId)?.size ?? 0;
      return {
        value: p.filamentId,
        label: p.name,
        detail: count ? plural(count, "change") : "",
        swatch: `#${p.colorRgba.slice(0, 6)}`,
      };
    });
    setScreen({
      name: "choose",
      title: "Edit the new presets of which filament?",
      items,
      multi: false,
      state: initialChoiceState(items, []),
      onDone: ([id]) => {
        const profile = plan.profiles.find((p) => p.filamentId === id);
        if (profile) void openPlanned(plan, profile);
      },
      onCancel: () => setScreen(plan),
    });
  }

  /** The form on the first preset the run writes for the profile, as it would write it. */
  async function openPlanned(plan: PlanScreen, profile: FilamentProfile): Promise<void> {
    const fail = (error: string): void => setScreen({ ...plan, error });
    const folder = values.presetFolder.trim();
    const all = printers(values);
    const found = await Promise.all(
      all.map((printer) =>
        access(presetPath(profile, folder, printer)).then(
          () => true,
          () => false,
        ),
      ),
    );
    const printer = all.find((_, i) => values.overwritePresets || !found[i]);
    if (printer === undefined) {
      fail(
        `${profile.name}'s presets are there already and the run keeps them: edit them from the menu's Edit a filament preset`,
      );
      return;
    }
    try {
      system.current ??= await SystemProfiles.load(bambuConfigDir());
    } catch (err) {
      fail(errorMessage(err));
      return;
    }
    const template = system.current.template(profile.material, printer);
    if (!template) {
      fail(`no Generic ${profile.material} preset in BambuStudio for ${printer}`);
      return;
    }
    const original = buildPreset(profile, printer, template, system.current.version);
    const preset: UserPreset = {
      name: profile.name,
      filamentId: profile.filamentId,
      printer,
      path: presetPath(profile, folder, printer),
    };
    setScreen({
      name: "edit",
      from: plan,
      preset,
      original,
      edits: planEdits.get(profile.filamentId) ?? new Map(),
      form: initialPresetForm(),
    });
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
      await showPlan(profiles);
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
      const [first] = prompts;
      if (!first) {
        await showPlan(applyWeights(profiles, groups, weightChoices));
        return;
      }
      const cursor = itemIndex(
        weightItems(first, profiles, sourceName),
        weightChoices.get(first.key),
      );
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
    setScreen({
      name: "loading",
      message:
        field === "presetFolder" ? "Reading BambuStudio folders…" : "Reading BambuStudio printers…",
    });
    try {
      let items: ChoiceItem[];
      let current: string[];
      if (field === "presetFolder") {
        const entries = await readdir(bambuUserRoot(), { withFileTypes: true }).catch(() => []);
        current = [values.presetFolder.trim()];
        const names = new Set([
          ...entries.filter((e) => e.isDirectory()).map((e) => e.name),
          ...current.filter(Boolean),
        ]);
        items = [...names].sort().map((name) => ({
          value: name,
          label: name,
          detail: name === "default" ? "used when not logged in to BambuStudio" : "",
        }));
      } else {
        const known = (await SystemProfiles.load(bambuConfigDir())).printers();
        current = printers(values);
        const unknown = current.filter((p) => !known.includes(p));
        items = [
          ...known.map((name) => ({ value: name, label: name.replace(/^Bambu Lab /, "") })),
          ...unknown.map((name) => ({
            value: name,
            label: name,
            detail: "not in BambuStudio's printers",
          })),
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
    setScreen({
      name: "loading",
      message: spoolmanDb ? "Loading SpoolmanDB…" : `Loading profiles from ${source}…`,
    });
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

  async function apply({ profiles, plans }: PlanScreen): Promise<void> {
    setScreen({ name: "running", profiles, plans });
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
          presetEdits: planEdits,
        },
        (event) => {
          if (event.type === "stage") setStage(event.stage);
          else if (event.type === "warning") setWarnings((w) => [...w, event.message]);
          else setProgress((p) => applyEvent(p, event));
        },
      );
      if (results.some(resultFailed)) setRunFailed(true);
      setScreen({ name: "done", profiles, plans, results });
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
    setScreen({
      name: "labels",
      spoolIds,
      fresh,
      back,
      form: initialLabelForm(saved, printerList),
    });
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
        .map((spool) => ({
          value: spool.id,
          label: `#${spool.id} ${[spool.brand, spool.material, spool.colorName].filter(Boolean).join(" ")}`,
          swatch: swatchOf(spool.colorCodes),
        }));
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
    const items = filaments.map((f) => ({
      value: f.code,
      label: f.name,
      detail: plural(f.count, "spool"),
      swatch: swatchOf(f.spool.colorCodes),
    }));
    setScreen({
      name: "choose",
      title: "Which filament? (more spools of one you have)",
      items,
      multi: false,
      state: initialChoiceState(items, current ? [current] : []),
      onDone: ([code]) => {
        const filament = filaments.find((f) => f.code === code);
        if (filament) chooseCopyCount(filaments, filament, 1);
      },
      onCancel: home,
    });
  }

  /** onCancel: where esc goes; the filament list unless the count was asked for from elsewhere. */
  function chooseCopyCount(
    filaments: CopyableFilament[],
    filament: CopyableFilament,
    current: number,
    onCancel?: () => void,
  ): void {
    const items = Array.from({ length: MAX_COPIES }, (_, i) => ({
      value: String(i + 1),
      label: plural(i + 1, "spool"),
    }));
    setScreen({
      name: "choose",
      title: `How many new spools of ${filament.name}?`,
      items,
      multi: false,
      state: initialChoiceState(items, [String(current)]),
      onDone: ([count]) =>
        setScreen({
          name: "copies",
          filaments,
          filament,
          count: Number(count),
          results: null,
          running: false,
        }),
      onCancel: onCancel ?? (() => chooseCopyFilament(filaments, filament.code)),
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

  /** The barcode screen, with the console's filaments a barcode can be. */
  async function openScan(): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    setScreen({ name: "loading", message: "Reading spools from SpoolEase…" });
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const spools = await client.listSpools();
      const names = await client
        .getCustomFilaments()
        .catch(() => new Map<string, CustomFilament>());
      const filaments = copyableFilaments(spools, names);
      if (filaments.length === 0) {
        setOutcome({ ok: false, lines: ["No spool on the console has a filament code to copy"] });
        home();
        return;
      }
      await scanAgain(filaments);
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't read the spools: ${errorMessage(err)}`] });
      home();
    }
  }

  async function scanAgain(filaments: CopyableFilament[], error = ""): Promise<void> {
    setScreen({ name: "scan", code: "", error, filaments, barcodes: await loadBarcodes() });
  }

  /** A known barcode goes to its filament (or another, if it was learned wrong); a new one asks which it is. */
  function lookUpBarcode(scan: Extract<Screen, { name: "scan" }>, typed: string): void {
    const barcode = normalizeBarcode(typed);
    const known = scan.barcodes.get(barcode);
    const filament = known ? scan.filaments.find((f) => f.code === known.code) : undefined;
    const back = (): void => void scanAgain(scan.filaments);
    if (!filament) {
      chooseBarcodeFilament(scan.filaments, barcode, known ?? null, back);
      return;
    }
    const items = [
      {
        value: "more",
        label: `More spools of ${filament.name}`,
        detail: `${plural(filament.count, "spool")} now`,
        swatch: swatchOf(filament.spool.colorCodes),
      },
      {
        value: "other",
        label: "A different filament",
        detail: "if this barcode was learned wrong",
      },
    ];
    setScreen({
      name: "choose",
      title: `Barcode ${barcode} is ${filament.name}`,
      items,
      multi: false,
      state: initialChoiceState(items, []),
      onDone: ([choice]) =>
        choice === "more"
          ? chooseCopyCount(scan.filaments, filament, 1, back)
          : chooseBarcodeFilament(scan.filaments, barcode, null, back),
      onCancel: back,
    });
  }

  function chooseBarcodeFilament(
    filaments: CopyableFilament[],
    barcode: string,
    gone: BarcodeFilament | null,
    back: () => void,
  ): void {
    const items = filaments.map((f) => ({
      value: f.code,
      label: f.name,
      detail: plural(f.count, "spool"),
      swatch: swatchOf(f.spool.colorCodes),
    }));
    setScreen({
      name: "choose",
      title: `Which filament is barcode ${barcode}?${gone ? ` (it was ${gone.name}, which no spool on the console is now)` : ""}`,
      items,
      multi: false,
      state: initialChoiceState(items, []),
      onDone: ([code]) => {
        const filament = filaments.find((f) => f.code === code);
        if (!filament) return;
        rememberBarcode(barcode, { code: filament.code, name: filament.name }).then(
          () => chooseCopyCount(filaments, filament, 1, back),
          (err: unknown) =>
            void scanAgain(filaments, `Couldn't remember barcode ${barcode}: ${errorMessage(err)}`),
        );
      },
      onCancel: back,
    });
  }

  /** The console's spools with what's left on each; reads only. */
  async function openSpools(): Promise<void> {
    const target = connection(values);
    if (!target) return;
    setOutcome(null);
    setScreen({ name: "loading", message: "Reading spools from SpoolEase…" });
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const spools = await client.listSpools();
      if (spools.length === 0) {
        setOutcome({ ok: false, lines: ["The SpoolEase console has no spools yet"] });
        home();
        return;
      }
      // Names only make the list nicer; spools carry the rest.
      const names = await client
        .getCustomFilaments()
        .catch(() => new Map<string, CustomFilament>());
      setScreen({ name: "spools", spools, names, state: initialSpoolList() });
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't read the spools: ${errorMessage(err)}`] });
      home();
    }
  }

  /** What to do with one spool from the list: a label, or more spools of its filament. */
  function chooseSpoolAction(
    list: Extract<Screen, { name: "spools" }>,
    spool: SpoolRecord,
    name: string,
  ): void {
    const items = [
      { value: "label", label: "Print a label", detail: "the label screen, for this spool" },
      ...(spool.slicerFilament
        ? [
            {
              value: "more",
              label: "Add more spools of this filament",
              detail: "copies of its newest spool",
            },
          ]
        : []),
    ];
    const back = (): void => setScreen(list);
    setScreen({
      name: "choose",
      title: `#${spool.id} ${name}`,
      items,
      multi: false,
      state: initialChoiceState(items, []),
      onDone: ([action]) => {
        if (action === "label") {
          void openLabels([spool.id], false, list);
          return;
        }
        const filaments = copyableFilaments(list.spools, list.names);
        const filament = filaments.find((f) => f.code === spool.slicerFilament);
        if (filament) chooseCopyCount(filaments, filament, 1, back);
      },
      onCancel: back,
    });
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
      const { sections, warnings, presets } = await readCheck(client, values.presetFolder.trim());
      setScreen({ name: "check", sections, warnings, top: 0, fixes: idFixes(presets) });
    } catch (err) {
      setOutcome({ ok: false, lines: [`Couldn't check: ${errorMessage(err)}`] });
      home();
    }
  }

  /** Writes the IDs, then shows each preset's result. */
  async function writeIds(fixes: IdFix[]): Promise<void> {
    setScreen({ name: "ids", fixes, results: null, running: true });
    const results = await fixPresetIds(fixes);
    if (results.some((r) => !r.ok)) setRunFailed(true);
    setScreen({ name: "ids", fixes, results, running: false });
  }

  /** The preset folder's own filament presets, to edit one; reads only. */
  async function openPresets(): Promise<void> {
    setOutcome(null);
    setScreen({ name: "loading", message: "Reading BambuStudio presets…" });
    const folder = values.presetFolder.trim();
    const { presets, warnings } = await readUserPresets(folder);
    if (presets.length === 0) {
      setOutcome({
        ok: false,
        lines: [`BambuStudio folder ${folder} has no filament presets of your own`, ...warnings],
      });
      home();
      return;
    }
    setScreen({ name: "presets", presets, warnings, state: initialPresetList() });
  }

  async function openPreset(list: PresetsScreen, preset: UserPreset): Promise<void> {
    try {
      const original: unknown = JSON.parse(await readFile(preset.path, "utf-8"));
      if (typeof original !== "object" || original === null || Array.isArray(original))
        throw new Error("it isn't a preset");
      setScreen({
        name: "edit",
        from: list,
        preset,
        original: original as Preset,
        edits: drafts.get(preset.path) ?? new Map(),
        form: initialPresetForm(),
      });
    } catch (err) {
      setScreen({
        ...list,
        state: {
          ...list.state,
          error: `Couldn't read ${basename(preset.path)}: ${errorMessage(err)}`,
        },
      });
    }
  }

  /** The edit with `edit` for `key`, or without one when `edit` is null or leaves the value as it is on disk. */
  function withEdit(edit: EditScreen, key: string, value: EditValue | null): EditScreen {
    const edits = new Map(edit.edits);
    edits.delete(key);
    if (value && editChanges(edit.original, new Map([[key, value]])).length > 0)
      edits.set(key, value);
    return { ...edit, edits };
  }

  /** Back to the list, keeping the edits for when the preset is opened again; or to the plan, once the edits make a preset. */
  function leaveEdit(edit: EditScreen): void {
    const keep = (edits: ReadonlyMap<string, Edits>, id: string): Map<string, Edits> => {
      const next = new Map(edits);
      if (edit.edits.size > 0) next.set(id, edit.edits);
      else next.delete(id);
      return next;
    };
    const from = edit.from;
    if (from.name === "presets") {
      setDrafts(keep(drafts, edit.preset.path));
      setScreen(from);
      return;
    }
    // The run writes the edits as they are, so they must make a preset BambuStudio takes.
    const range = rangeError(applyEdits(edit.original, edit.edits).preset);
    if (range) {
      setScreen({ ...edit, form: { ...edit.form, error: range } });
      return;
    }
    const edits = keep(planEdits, edit.preset.filamentId);
    setPlanEdits(edits);
    void planScreen(from.profiles, from.spoolease, from.warning, edits).then(setScreen);
  }

  /** Which presets of the filament the edit goes into (when it has several), then the review. */
  function reviewEdit(edit: EditScreen): void {
    if (edit.from.name === "plan") {
      leaveEdit(edit);
      return;
    }
    const fail = (error: string): void => setScreen({ ...edit, form: { ...edit.form, error } });
    if (editChanges(edit.original, edit.edits).length === 0) {
      fail("Nothing changed yet");
      return;
    }
    const range = rangeError(applyEdits(edit.original, edit.edits).preset);
    if (range) {
      fail(range);
      return;
    }
    const family = presetFamily(edit.from.presets, edit.preset);
    if (family.length === 1) {
      void openSave(edit, family);
      return;
    }
    const items = family.map((p) => ({
      value: p.path,
      label: p.printer.replace(/^Bambu Lab /, "") || basename(p.path),
      detail: p.path === edit.preset.path ? "the one you edited" : "same filament ID",
    }));
    setScreen({
      name: "choose",
      title: `Save to which presets of ${edit.preset.name}?`,
      items,
      multi: true,
      state: initialChoiceState(
        items,
        family.map((p) => p.path),
      ),
      onDone: (paths) =>
        void openSave(
          edit,
          family.filter((p) => paths.includes(p.path)),
        ),
      onCancel: () => setScreen(edit),
    });
  }

  /** The review; reads SpoolEase's custom filament when the edit changes the nozzle range it also holds. */
  async function openSave(edit: EditScreen, targets: UserPreset[]): Promise<void> {
    const save: SaveScreen = {
      name: "save",
      edit,
      targets,
      spoolease: null,
      warning: "",
      results: null,
      spooleaseResult: null,
      running: false,
    };
    const changed = editChanges(edit.original, edit.edits).some((c) =>
      c.key.startsWith("nozzle_temperature_range_"),
    );
    const range = nozzleRange(applyEdits(edit.original, edit.edits).preset);
    const code = edit.preset.filamentId;
    const target = connection(values);
    if (!changed || !range || !code || !target) {
      setScreen(save);
      return;
    }
    setScreen({ name: "loading", message: "Reading SpoolEase's custom filaments…" });
    try {
      const client = new SpoolEaseClient(target);
      await checkKey(client);
      const listed = (await client.getCustomFilaments()).get(code);
      const same = listed?.nozzleTempMin === range.low && listed?.nozzleTempMax === range.high;
      const spoolease =
        listed && !same
          ? {
              code,
              from: `${listed.nozzleTempMin ?? "?"}-${listed.nozzleTempMax ?? "?"} °C`,
              to: `${range.low}-${range.high} °C`,
              ...range,
            }
          : null;
      setScreen({ ...save, spoolease });
    } catch (err) {
      setScreen({
        ...save,
        warning: `Couldn't read SpoolEase, so its nozzle range for ${code} stays as it is: ${errorMessage(err)}`,
      });
    }
  }

  /** Writes the presets, then SpoolEase's nozzle range when the review showed it changing. */
  async function saveEdit(save: SaveScreen): Promise<void> {
    setScreen({ ...save, running: true });
    const results = await writePresetEdits(
      save.targets.map((t) => t.path),
      save.edit.edits,
    );
    let spooleaseResult: SaveScreen["spooleaseResult"] = null;
    const target = connection(values);
    const range = save.spoolease;
    if (range && target && results.some((r) => r.ok)) {
      try {
        const client = new SpoolEaseClient(target);
        await checkKey(client);
        // Read again just before writing: SpoolEase replaces the whole CSV on every write.
        const csv = withNozzleRange(
          await client.getCustomFilamentsCsv(),
          range.code,
          range.low,
          range.high,
        );
        if (csv === null)
          spooleaseResult = {
            ok: false,
            line: `SpoolEase no longer lists ${range.code}; nothing changed there`,
          };
        else {
          const written = await client.setCustomFilamentsCsv(csv);
          spooleaseResult = written.ok
            ? { ok: true, line: `SpoolEase's nozzle range for ${range.code} is ${range.to}` }
            : { ok: false, line: `SpoolEase didn't take the nozzle range: ${written.error}` };
        }
      } catch (err) {
        spooleaseResult = {
          ok: false,
          line: `Couldn't change SpoolEase's nozzle range: ${errorMessage(err)}`,
        };
      }
    }
    if (results.some((r) => !r.ok) || spooleaseResult?.ok === false) setRunFailed(true);
    const next = new Map(drafts);
    next.delete(save.edit.preset.path);
    setDrafts(next);
    setScreen({ ...save, results, spooleaseResult, running: false });
  }

  /** Back to the menu after a run, saying what it did; the next run starts with nothing selected. */
  function finishRun(profiles: FilamentProfile[], results: SyncResult[]): void {
    const failed = results.filter(resultFailed).length;
    const created = newSpoolIds(results).length;
    const source = fromSpoolmanDb ? activeSource : basename(activeSource);
    const spools = created > 0 ? `, ${plural(created, "new spool")}` : "";
    setOutcome({
      ok: failed === 0,
      lines: [
        `${plural(profiles.length, "profile")} from ${source}: ${results.length - failed} written, ${failed} failed${spools}`,
      ],
    });
    setPicker({ ...picker, selected: new Set() });
    setWeightChoices(new Map());
    setPlanEdits(new Map());
    setScreen({ name: "home", cursor: initialHomeCursor(menuItems()) });
  }

  async function printLabels(
    spoolIds: string[],
    back: Screen,
    form: LabelFormState,
    target: LabelTarget,
  ): Promise<void> {
    const spoolease = connection(values);
    setScreen({ name: "loading", message: "Making labels…" });
    const lines: string[] = [];
    let ok = true;
    try {
      if (!spoolease) throw new Error("SpoolEase is skipped");
      const made = await makeLabels(
        new SpoolEaseClient(spoolease),
        { ids: spoolIds, brand: "", material: "", match: "" },
        target,
        (w) => lines.push(w),
      );
      const count = plural(made.spools.length, "label");
      if (target.output) lines.push(`Wrote ${count} to ${target.output}`);
      if (made.printError) {
        ok = false;
        lines.push(made.printError);
      } else if (target.printer) {
        lines.push(
          `Sent ${count} to ${target.printer}${made.printReply ? `: ${made.printReply}` : ""}`,
        );
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

  /** The help page ? opens here, or null where ? is typed (a text field) or nothing waits for keys. */
  function helpTopic(s: Screen): { topic: HelpTopic; multi: boolean } | null {
    const page = (topic: HelpTopic, multi = false) => ({ topic, multi });
    switch (s.name) {
      case "form":
        return formTyping(connectionOpen(values, connectionRequested), formFocus)
          ? null
          : page("form");
      case "choose":
        return page("choose", s.multi);
      case "color":
        return colorFormTyping(s.form) ? null : page("color");
      case "labels":
        return labelFormTyping(s.form) ? null : page("labels");
      case "edit":
        return presetFormTyping(s.form) ? null : page(s.from.name === "plan" ? "planned" : "edit");
      case "raw":
        return rawTyping(s.state) ? null : page("raw");
      case "copies":
      case "ids":
      case "save":
        return s.running ? null : page(s.name);
      case "loading":
      case "running":
      case "help":
        return null;
      default:
        return page(s.name);
    }
  }

  // Always subscribed: toggling isActive re-attaches Ink's listener in an effect after the
  // new screen renders, so a key pressed right after "Done" appears could be dropped.
  useInput((input, key) => {
    if (screen.name === "help") {
      setScreen(screen.back);
      return;
    }
    const help = input === "?" && !key.ctrl && !key.meta ? helpTopic(screen) : null;
    if (help) {
      setScreen({ name: "help", ...help, back: screen });
      return;
    }
    if (screen.name === "home") {
      const items = menuItems();
      const action = homeInput(screen.cursor, input, key, items);
      if (action.type === "move") setScreen({ name: "home", cursor: action.cursor });
      else if (action.type === "choose") {
        if (action.id === "spoolmandb") void loadPlan(SPOOLMANDB_SOURCE);
        else if (action.id === "import") void loadPlan(values.source);
        else if (action.id === "more") void openMoreSpools();
        else if (action.id === "barcode") void openScan();
        else if (action.id === "labels") void openSpoolLabels();
        else if (action.id === "spools") void openSpools();
        else if (action.id === "edit") void openPresets();
        else if (action.id === "check") void openCheck();
        else if (action.id === "settings") setScreen({ name: "form", error: "" });
        else onExit(runFailed ? 1 : 0);
      }
    } else if (screen.name === "choose") {
      const action = choiceInput(
        screen.state,
        input,
        key,
        screen.items,
        screen.multi,
        Date.now(),
        choiceRows(height),
      );
      if (action.type === "update") setScreen({ ...screen, state: action.state });
      else if (action.type === "cancel") screen.onCancel();
      else if (action.type === "done") screen.onDone(action.values);
    } else if (screen.name === "browse") {
      if (!catalog) return;
      const action = browseInput(
        browse,
        input,
        key,
        catalog.profiles,
        picker.selected,
        Date.now(),
        browseListRows(height, catalog.warnings.length),
      );
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
        const listed = browseRows(browse, catalog.profiles, picker.selected).flatMap((r) =>
          r.kind === "product" ? [r.profile] : [],
        );
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
          onDone: ([id]) =>
            setScreen({
              name: "color",
              form: {
                ...form,
                base: listed.find((p) => p.filamentId === id) ?? null,
                cursor: form.base ? form.cursor : form.cursor + 1,
              },
            }),
          onCancel: () => setScreen({ name: "color", form }),
        });
      } else {
        const made = colorFormProfile(screen.form, catalog.profiles);
        if ("error" in made) setScreen({ ...screen, form: { ...screen.form, error: made.error } });
        else {
          // The new color joins the catalog for this session, ticked, so it goes on like any listed color.
          const profiles = [...catalog.profiles, made.profile];
          const selected = new Set(picker.selected).add(made.profile.filamentId);
          const cursor = browseRows(browse, profiles, selected).findIndex(
            (r) => r.kind === "product" && r.profile.filamentId === made.profile.filamentId,
          );
          setCatalog({ ...catalog, profiles });
          setPicker({ ...picker, selected });
          setBrowse({ ...browse, cursor });
          setScreen({ name: "browse" });
        }
      }
    } else if (screen.name === "pick") {
      const action = pickerInput(
        picker,
        input,
        key,
        matches,
        pickerRows(height, catalog?.warnings.length ?? 0),
      );
      if (action.type === "update") setPicker(action.state);
      else if (action.type === "back") setScreen({ name: "browse" });
      else if (catalog) {
        setChooser("pick");
        void chooseWeights(catalog.profiles.filter((p) => picker.selected.has(p.filamentId)));
      }
    } else if (screen.name === "weights") {
      const { profiles, groups, prompts, step } = screen;
      const prompt = prompts[step];
      if (!prompt) return;
      const items = weightItems(prompt, profiles, sourceName);
      const action = weightInput(screen.cursor, key, items.length);
      const cursorFor = (group: WeightGroup, choices: ReadonlyMap<string, WeightChoice>): number =>
        itemIndex(weightItems(group, profiles, sourceName), choices.get(group.key));
      if (action.type === "move") {
        setScreen({ ...screen, cursor: action.cursor });
      } else if (action.type === "back") {
        const previous = prompts[step - 1];
        if (!previous) back();
        else setScreen({ ...screen, step: step - 1, cursor: cursorFor(previous, weightChoices) });
      } else if (action.type === "choose") {
        const item = items[screen.cursor];
        if (!item) return;
        const choices = new Map(weightChoices).set(prompt.key, item.choice);
        setWeightChoices(choices);
        const following = prompts[step + 1];
        if (following)
          setScreen({ ...screen, step: step + 1, cursor: cursorFor(following, choices) });
        else void showPlan(applyWeights(profiles, groups, choices));
      }
    } else if (screen.name === "plan") {
      if (input === "a") void apply(screen);
      else if (input === "e") choosePlanned(screen);
      else if (input === "b") back();
      else if (input === "q") onExit(0);
    } else if (screen.name === "done") {
      if (input === "q") onExit(screen.results.some(resultFailed) ? 1 : 0);
      else if (input === "l" && newSpoolIds(screen.results).length > 0)
        void openLabels(newSpoolIds(screen.results), true, screen);
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
        setOutcome({
          ok: failed === 0,
          lines: [
            `${plural(created.length, "spool")} of ${screen.filament.name} added${failed ? `, ${failed} failed` : ""}`,
          ],
        });
        home();
      }
    } else if (screen.name === "labels") {
      const action = labelFormInput(screen.form, input, key);
      if (action.type === "update") setScreen({ ...screen, form: action.state });
      else if (action.type === "choose") {
        const labels = screen;
        const size = action.list === "size";
        const items = size
          ? labelSizeItems(labels.form.size)
          : labelPrinterItems(labels.form.printers);
        const current = size ? labels.form.size : labels.form.printer;
        setScreen({
          name: "choose",
          title: size ? "Label size" : "Print with",
          items,
          multi: false,
          state: initialChoiceState(items, [current]),
          onDone: ([value = ""]) =>
            setScreen({ ...labels, form: { ...labels.form, [size ? "size" : "printer"]: value } }),
          onCancel: () => setScreen(labels),
        });
      } else if (action.type === "back") setScreen(screen.back);
      else {
        const checked = labelFormTarget(screen.form);
        if ("error" in checked)
          setScreen({ ...screen, form: { ...screen.form, error: checked.error } });
        else void printLabels(screen.spoolIds, screen.back, screen.form, checked.target);
      }
    } else if (screen.name === "check") {
      const action = checkInput(
        screen.top,
        input,
        key,
        checkLines(screen.sections).length,
        checkRows(height, screen.warnings.length),
      );
      if (action.type === "scroll") setScreen({ ...screen, top: action.top });
      else if (action.type === "back") home();
      else if (action.type === "again") void openCheck();
      else if (action.type === "fix" && screen.fixes.length > 0)
        setScreen({ name: "ids", fixes: screen.fixes, results: null, running: false });
      else if (action.type === "quit") onExit(0);
    } else if (screen.name === "scan") {
      const action = scanInput(screen.code, input, key);
      if (action.type === "update") setScreen({ ...screen, code: action.code, error: "" });
      else if (action.type === "back") home();
      else if (action.type === "submit") lookUpBarcode(screen, action.code);
    } else if (screen.name === "spools") {
      const rows = inventoryRows(
        screen.spools,
        screen.names,
        screen.state.filter,
        screen.state.sort,
      );
      const action = spoolListInput(screen.state, input, key, rows.length, spoolListRows(height));
      if (action.type === "update") setScreen({ ...screen, state: action.state });
      else if (action.type === "back") home();
      else if (action.type === "choose") {
        const row = rows[action.index];
        if (row) chooseSpoolAction(screen, row.spool, row.name);
      }
    } else if (screen.name === "ids") {
      if (screen.running) return;
      if (input === "q") onExit(runFailed ? 1 : 0);
      else if (input === "b") void openCheck();
      else if (input === "a" && screen.results === null) void writeIds(screen.fixes);
      else if (input === "m" && screen.results !== null) {
        const written = screen.results.filter((r) => r.ok).length;
        const failed = screen.results.length - written;
        setOutcome({
          ok: failed === 0,
          lines: [
            `${plural(written, "BambuStudio preset")} given a filament ID${failed ? `, ${failed} failed` : ""}: restart BambuStudio to load`,
          ],
        });
        home();
      }
    } else if (screen.name === "presets") {
      const matches = presetMatches(screen.presets, screen.state.filter);
      const action = presetListInput(
        screen.state,
        input,
        key,
        matches.length,
        presetListRows(height, screen.warnings.length),
      );
      if (action.type === "update") setScreen({ ...screen, state: action.state });
      else if (action.type === "back") home();
      else if (action.type === "choose") {
        const match = matches[action.index];
        if (match) void openPreset(screen, match);
      }
    } else if (screen.name === "edit") {
      const action = presetFormInput(
        screen.form,
        input,
        key,
        applyEdits(screen.original, screen.edits).preset,
        presetFormRows(height),
      );
      if (action.type === "update") setScreen({ ...screen, form: action.state });
      else if (action.type === "set")
        setScreen({ ...withEdit(screen, action.key, action.edit), form: action.state });
      else if (action.type === "undo")
        setScreen({ ...withEdit(screen, action.key, null), form: { ...screen.form, error: "" } });
      else if (action.type === "raw")
        setScreen({ name: "raw", edit: screen, state: initialRawSettings() });
      else if (action.type === "review") reviewEdit(screen);
      else if (action.type === "back") leaveEdit(screen);
    } else if (screen.name === "raw") {
      const edited = applyEdits(screen.edit.original, screen.edit.edits).preset;
      const action = rawInput(
        screen.state,
        input,
        key,
        rawKeys(edited, screen.state.filter),
        edited,
        rawRows(height),
      );
      if (action.type === "update") setScreen({ ...screen, state: action.state });
      else if (action.type === "set")
        setScreen({
          ...screen,
          edit: withEdit(screen.edit, action.key, action.edit),
          state: action.state,
        });
      else if (action.type === "undo")
        setScreen({
          ...screen,
          edit: withEdit(screen.edit, action.key, null),
          state: { ...screen.state, error: "" },
        });
      else if (action.type === "back") setScreen(screen.edit);
    } else if (screen.name === "save") {
      if (screen.running) return;
      if (input === "q") onExit(runFailed ? 1 : 0);
      else if (screen.results === null) {
        if (input === "a") void saveEdit(screen);
        else if (input === "b") setScreen(screen.edit);
      } else if (input === "e") void openPresets();
      else if (input === "m") {
        const saved = screen.results.filter((r) => r.ok).length;
        const failed = screen.results.length - saved;
        const lines = [
          `${plural(saved, "BambuStudio preset")} of ${screen.edit.preset.name} saved${failed ? `, ${failed} failed` : ""}: restart BambuStudio to load`,
        ];
        if (screen.spooleaseResult) lines.push(screen.spooleaseResult.line);
        setOutcome({ ok: failed === 0 && screen.spooleaseResult?.ok !== false, lines });
        home();
      }
    } else if (screen.name === "error") {
      if (input === "b") setScreen({ name: "form", error: "" });
      else if (input === "q") onExit(screen.exitCode);
    }
  });

  if (screen.name === "home") {
    const target = connection(values);
    const context: TextPart[][] = [
      [`BambuStudio: ${values.presetFolder.trim()} · ${printers(values).join(", ")}`],
      target
        ? [
            "SpoolEase: ",
            { text: target.host, url: consoleUrl(target) },
            values.createSpools ? "" : " (register filaments only)",
          ]
        : ["SpoolEase: skipped"],
    ];
    return (
      <HomeMenu items={menuItems()} cursor={screen.cursor} context={context} outcome={outcome} />
    );
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
    return (
      <ChoiceList
        title={screen.title}
        items={screen.items}
        state={screen.state}
        multi={screen.multi}
        height={height}
      />
    );
  }

  if (screen.name === "loading") {
    return <Busy message={screen.message} />;
  }

  if (screen.name === "weights") {
    // biome-ignore lint/style/noNonNullAssertion: step is always an index into prompts: the screen opens at 0 only when prompts has a first group, and the input handler moves it only onto a group that exists.
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
        height={height}
      />
    );
  }

  if (screen.name === "browse") {
    return (
      <Browse
        state={browse}
        profiles={catalog?.profiles ?? []}
        selected={picker.selected}
        warnings={catalog?.warnings ?? []}
        height={height}
      />
    );
  }

  if (screen.name === "color") {
    return (
      <ColorForm state={screen.form} brand={browse.brand ?? ""} material={browse.material ?? ""} />
    );
  }

  if (screen.name === "pick") {
    return (
      <Picker
        catalogSize={catalog?.profiles.length ?? 0}
        matches={matches}
        state={picker}
        warnings={catalog?.warnings ?? []}
        height={height}
      />
    );
  }

  if (screen.name === "copies") {
    const target = connection(values);
    return (
      <SpoolCopies
        filament={screen.filament}
        count={screen.count}
        target={
          target
            ? {
                text: `${target.https ? "https" : "http"}://${target.host}:${target.port}`,
                url: consoleUrl(target),
              }
            : "skipped"
        }
        results={screen.results}
        running={screen.running}
        outcome={outcome}
      />
    );
  }

  if (screen.name === "check") {
    const target = connection(values);
    const compared: TextPart[] = [
      `BambuStudio ${values.presetFolder.trim()} · SpoolEase `,
      target ? { text: `${target.host}:${target.port}`, url: consoleUrl(target) } : "skipped",
    ];
    return (
      <SyncCheck
        sections={screen.sections}
        top={screen.top}
        compared={compared}
        warnings={screen.warnings}
        fixable={screen.fixes.length}
        height={height}
      />
    );
  }

  if (screen.name === "scan") {
    return <BarcodeScan code={screen.code} error={screen.error} known={screen.barcodes.size} />;
  }

  if (screen.name === "spools") {
    const rows = inventoryRows(screen.spools, screen.names, screen.state.filter, screen.state.sort);
    return (
      <SpoolList rows={rows} total={screen.spools.length} state={screen.state} height={height} />
    );
  }

  if (screen.name === "ids") {
    return <PresetIds fixes={screen.fixes} results={screen.results} running={screen.running} />;
  }

  if (screen.name === "presets") {
    const matches = presetMatches(screen.presets, screen.state.filter);
    return (
      <PresetList
        matches={matches}
        total={screen.presets.length}
        folder={`BambuStudio folder ${values.presetFolder.trim()}`}
        drafts={new Set(drafts.keys())}
        state={screen.state}
        warnings={screen.warnings}
        height={height}
      />
    );
  }

  if (screen.name === "edit") {
    const edited = applyEdits(screen.original, screen.edits).preset;
    return (
      <PresetForm
        preset={screen.preset}
        original={screen.original}
        edited={edited}
        edits={screen.edits}
        state={screen.form}
        planned={screen.from.name === "plan"}
        height={height}
      />
    );
  }

  if (screen.name === "raw") {
    const edited = applyEdits(screen.edit.original, screen.edit.edits).preset;
    return (
      <RawSettings
        preset={screen.edit.preset}
        edited={edited}
        edits={screen.edit.edits}
        state={screen.state}
        height={height}
      />
    );
  }

  if (screen.name === "save") {
    return (
      <PresetReview
        preset={screen.edit.preset}
        changes={editChanges(screen.edit.original, screen.edit.edits)}
        targets={screen.targets}
        spoolease={screen.spoolease}
        warning={screen.warning}
        results={screen.results}
        spooleaseResult={screen.spooleaseResult}
        running={screen.running}
      />
    );
  }

  if (screen.name === "labels") {
    return <LabelForm state={screen.form} spoolIds={screen.spoolIds} fresh={screen.fresh} />;
  }

  if (screen.name === "help") {
    return <Help topic={screen.topic} multi={screen.multi} />;
  }

  if (screen.name === "error") {
    return (
      <Box flexDirection="column">
        <Status variant="error">{screen.message}</Status>
        <Text dimColor>[b] back to settings · [q] quit · ? help</Text>
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
          {tildePath(bambuBaseFilamentDir(values.presetFolder.trim()))} ·{" "}
          {values.overwritePresets ? "existing presets replaced" : "existing presets kept"}
        </Text>
        <Text>
          {"Printers:  "}
          {printers(values).join(", ")}
        </Text>
        <Text>
          {"SpoolEase: "}
          {target ? (
            <LinkedText
              parts={[
                {
                  text: `${target.https ? "https" : "http"}://${target.host}:${target.port}`,
                  url: consoleUrl(target),
                },
                ` · ${values.createSpools ? "register filaments + create spools" : "register filaments only"}`,
              ]}
            />
          ) : (
            "skipped"
          )}
        </Text>
      </Box>
      <Box marginY={1}>
        <PlanTable
          profiles={screen.profiles}
          progress={progress}
          plans={screen.plans}
          overwrite={values.overwritePresets}
          activePresets={stage === "presets"}
          activeSpools={stage === "spools"}
          columns={columns}
        />
      </Box>
      {screen.name === "plan" && screen.plans ? (
        <PlanNotes
          profiles={screen.profiles}
          plans={screen.plans}
          overwrite={values.overwritePresets}
          edits={planEdits}
        />
      ) : null}
      {screen.name === "running" ? (
        <RunProgress progress={progress} total={screen.profiles.length} />
      ) : null}
      {screen.name === "plan" && screen.warning ? (
        <Status variant="warning">{screen.warning}</Status>
      ) : null}
      {screen.name === "plan" && screen.error ? (
        <Status variant="error">{screen.error}</Status>
      ) : null}
      {stage ? <Busy color="cyan" message={`${STAGE_LABELS[stage]}…`} /> : null}
      {[...weightWarnings, ...warnings].map((w) => (
        <Status key={w} variant="warning">
          {w}
        </Status>
      ))}
      {screen.name === "plan" ? (
        <Text dimColor>
          [a] apply · [e] edit presets · [b] back to{" "}
          {fromSpoolmanDb && catalog ? "filaments" : "menu"} · [q] quit · ? help
        </Text>
      ) : null}
      {screen.name === "done" ? (
        <Box flexDirection="column">
          <Status variant={failed.length ? "error" : "success"}>
            <Text bold>
              Done: {screen.results.length - failed.length} written, {failed.length} failed
            </Text>
          </Status>
          {failed.map((r) => (
            <Status key={r.profileName} variant="error">
              {r.profileName}: {r.detail}
            </Status>
          ))}
          {outcome?.lines.map((line) => (
            <Status key={line} variant={outcome.ok ? "success" : "error"}>
              {line}
            </Status>
          ))}
          <Text dimColor>
            {created > 0
              ? `[l] labels for ${plural(created, "new spool")} · [m] menu · [q] quit · ? help`
              : "[m] menu · [q] quit · ? help"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
