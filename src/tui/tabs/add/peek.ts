// ABOUTME: What adding Find's highlighted color would do, worked out as Review's plan does (previewPlan), cached.
// ABOUTME: The console is read once per settings and each filament once; until known the detail says so, never promises.

import type { FilamentProfile } from "../../../models.js";
import type { ProfilePlan } from "../../../planPreview.js";
import type { Ctx, Step } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { plural, shortPrinter } from "../../ui/format.js";
import { type AddLine, type FindDetail, findDetail, materialsOf } from "./catalog.js";
import { type AddMsg, peekCmd, peekConsoleCmd } from "./cmds.js";
import { type AddModel, emptyPeek, findRow, sourcesOf } from "./model.js";
import {
  consoleOf,
  createsSpools,
  planBasis,
  printersOf,
  sameBasis,
} from "./targets.js";

/** The highlighted color's profile, when Find shows one. */
function highlighted(model: AddModel, ctx: Ctx): FilamentProfile | null {
  if (model.page !== "find" || model.dialog) return null;
  const row = findRow(model, ctx);
  return row?.kind === "color" ? row.profile : null;
}

/**
 * Asks for what's missing to describe the highlighted color: the console once per settings, then the
 * color's plan. Run after every Find update; it does nothing once both are there.
 */
export function peekStep(model: AddModel, ctx: Ctx): Step<AddModel> {
  const profile = highlighted(model, ctx);
  if (!profile) return [model, []];
  const basis = planBasis(ctx.values);
  let peek =
    model.peek.basis && sameBasis(model.peek.basis, basis) ? model.peek : { ...emptyPeek(), basis };
  const cmds = [];
  if (peek.console === "idle" && consoleOf(ctx.values)) {
    peek = { ...peek, console: "loading" };
    cmds.push(peekConsoleCmd(basis, ctx.values));
  }
  if (peek.console !== "loading" && !peek.plans.has(profile.filamentId)) {
    peek = { ...peek, plans: new Map(peek.plans).set(profile.filamentId, "loading") };
    cmds.push(peekCmd(basis, profile, ctx.values, peek.state, model.planEdits));
  }
  return [peek === model.peek ? model : { ...model, peek }, cmds];
}

/** A peek's reply, kept when it was read with the settings still current. */
export function peekReply(
  model: AddModel,
  msg: Extract<AddMsg, { type: "add/peekConsole" | "add/peeked" }>,
): AddModel {
  const { peek } = model;
  if (!peek.basis || !sameBasis(peek.basis, msg.basis)) return model;
  if (msg.type === "add/peekConsole")
    return {
      ...model,
      peek: { ...peek, console: msg.state ? "ready" : "failed", state: msg.state },
    };
  return { ...model, peek: { ...peek, plans: new Map(peek.plans).set(msg.filamentId, msg.plan) } };
}

/** Plans read before presets or the console changed (a run, the Presets tab) are read again. */
export function forgetPeeks(model: AddModel): AddModel {
  return { ...model, peek: emptyPeek() };
}

function presetLine(plan: ProfilePlan, printers: string[], overwrite: boolean): AddLine {
  const names = printers.map(shortPrinter).join(", ");
  const { presets, existingPresets: kept } = plan;
  const many = presets > 1;
  const noun = `BambuStudio preset${many ? "s" : ""} for ${names}`;
  const count = many ? `${presets} presets` : "preset";
  if (kept === 0) return { mark: "+", text: many ? noun : `a ${noun}`, short: `+ ${count}` };
  if (kept === presets)
    return overwrite
      ? { mark: "↻", text: `${noun}: replaced`, short: `↻ ${count} replaced` }
      : { mark: "=", text: `${noun}: kept`, short: `= ${count} kept` };
  const fresh = presets - kept;
  if (overwrite)
    return {
      mark: "↻",
      text: `${noun}: ${fresh} new, ${kept} replaced`,
      short: `↻ ${count}`,
    };
  return {
    mark: "+",
    text: `${plural(fresh, "new BambuStudio preset")}; ${kept} kept`,
    short: `+ ${fresh} of ${presets} presets`,
  };
}

/** What adding the profile does with these settings, as Review will say it; null until it's known. */
export function addLines(
  profile: FilamentProfile,
  model: AddModel,
  values: FormValues,
): AddLine[] | null {
  const { peek } = model;
  if (!peek.basis || !sameBasis(peek.basis, planBasis(values))) return null;
  const plan = peek.plans.get(profile.filamentId);
  if (plan === undefined || plan === "loading") return null;
  if (plan === null)
    return [{ mark: "?", text: "checked on Review: couldn't look just now", short: "? on Review" }];
  const printers = printersOf(values);
  const lines: AddLine[] =
    printers.length > 0 ? [presetLine(plan, printers, values.overwritePresets)] : [];
  if (!consoleOf(values)) return lines;
  const { filament, spool } = plan;
  if (!filament)
    return [
      ...lines,
      {
        mark: "?",
        text: "SpoolEase: couldn't read it, Review checks again",
        short: "? SpoolEase on Review",
      },
    ];
  lines.push(
    filament.state === "new"
      ? { mark: "+", text: "a SpoolEase custom filament", short: "+ custom filament" }
      : filament.state === "same"
        ? { mark: "=", text: "on SpoolEase's custom filaments already", short: "= listed" }
        : {
            mark: "↻",
            text: "its SpoolEase custom filament is updated",
            short: "↻ custom filament",
          },
  );
  if (createsSpools(values) && spool)
    lines.push(
      spool === "create"
        ? { mark: "+", text: "a SpoolEase spool", short: "+ spool" }
        : { mark: "=", text: "a SpoolEase spool is there: no new one", short: "= has spool" },
    );
  return lines;
}

/** Find's detail for the highlighted row, as the detail panel draws it. */
export function findDetailOf(model: AddModel, ctx: Ctx): FindDetail | null {
  const level = model.search ? null : (model.stack.at(-1)?.level ?? { kind: "brands" as const });
  return findDetail(level, findRow(model, ctx), sourcesOf(model, ctx), model.selected, (profile) =>
    addLines(profile, model, ctx.values),
  );
}

/** The detail panel's title when there's no detail: a brand's material count. */
export function detailTitle(model: AddModel, ctx: Ctx, detail: FindDetail | null): string {
  if (detail) return detail.title;
  const level = model.search ? null : model.stack.at(-1)?.level;
  return level?.kind === "materials"
    ? `${materialsOf(sourcesOf(model, ctx), level.brand).length} materials`
    : "";
}
