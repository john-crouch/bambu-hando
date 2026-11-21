---
name: tui-ux
description: Interaction and layout rules for bambu-hando's full-screen Ink TUI (src/tui/), and how to check a screen the way a real terminal shows it. Use before adding or changing any TUI tab, dialog, key binding, list, column layout or TUI test.
---

# bambu-hando TUI: UX rules and workflow

The TUI is where you look after your filament without typing. `docs/tui-design.md` is the design; this is
the checklist for changing it.

## Interaction rules

- **Places, not sequences.** Five tabs (Spools, Add, Presets, Check, Settings), switched with tab/shift+tab.
  Inside a tab, pages (steps or sections) sit in a `PageBar` and move with ←/→. A new feature goes into the
  tab it belongs to, as a page, a dialog or an action, never as a new top-level screen.
- **Choose, don't type.** Offer a list built from what bambu-hando can read (BambuStudio folders and printers,
  SpoolmanDB, the console's spools and catalog, `lpstat -e`, remembered choices). Free text only where no list
  can exist, and then as the last item ("Other…").
- **Same keys everywhere.** ↑↓ pgup pgdn home end move · enter open/choose/continue · esc back (close a dialog,
  clear a filter, up a level, previous page) · space ticks · `/` filters or searches · letters type-ahead in
  plain lists · `a` applies on a review or confirm · `?` help · `ctrl+k` palette · `q` quits · ctrl+c quits from
  anywhere. A tab's own single-letter actions (`l`, `+`, `b`, `e`, `f`, `r`, `s`, `t`) are listed in its hints.
- **Text fields take every printable key.** While one is focused, `capturesText` is true, so `q`, `?`, `/` and
  letters type; the footer drops `q` and `?` meanwhile.
- **Show, then act.** Lists come with a detail panel that says what an action would change. Anything that writes
  goes through a review page or a confirm dialog naming every target, then `a`. After a write: `app/runFinished`
  (with `exitCode` for failures), `app/load {force}` of what changed, and a toast (tone only; the footer draws the
  icon).
- **Never lose work.** A tab's model survives switching tabs; selections, drafts and form values survive esc.
- **Dialogs belong to the shell's layer.** A tab's own dialog is drawn by `dialog(model, ctx)`, never inside its
  View: the shell puts it over the dimmed body with a clear halo. Size it with `dialogWidth` / `dialogRows`, give it
  no key line (the footer shows the tab's `hints()` while `modal()` is true, and q/tab go to the tab then).
- **Never lose work or cut a write short.** `busy(model)` names a running write (q is refused meanwhile);
  `unsaved(model)` counts edits q would drop (q asks first). Say each outcome once: no toast when the result is on
  screen.
- **Every problem has a key that fixes it**: deep-link with `app/switchTab { tab, focus }` using the focus strings in
  each tab's `index.ts` (settings rows like `spoolease.host`, a check section key, a preset path, a spool id, a
  filament ID or `id:<id>|name:<name>` for Add).
- **One spelling**: values through `ui/format.ts` (`formatTemp` `220°C`, `formatRange` `190–230°C`, `formatGrams`,
  `shortPrinter` `X1C 0.4`, `plural`, `fitPath` for paths, which keeps the file name); one-of choices with the
  List `radio` marker (`●`/`○`); sentence case; hints ordered move → act → navigate → global, `?` always kept.
- **Every list has a state for loading, failed (with `r`), and empty** (what to do, and where: `Empty` with an
  action), never a blank panel.
- **Preselect what the user picked last**, remembered in `configDir()` JSON (`tuiSettings.ts`, `labelSettings.ts`,
  `barcodes.ts` pattern: atomic write, damaged values fall back to defaults).
- **Show colors as swatches** (`Swatch`, a list row's `swatch`) and values for people: `220°C`, `190–230°C`,
  `564 g`, `56%`; codes and IDs dim, mostly in the detail panel.
- **`?` help comes from the same hints as the footer**, plus the tab's paragraph in `app/help.tsx`; add one for a
  new tab.

## Code rules

- **Bubble Tea's architecture.** A tab is a `TabModule` (`core/types.ts`): `init`, pure `update(model, msg, ctx)
  → [model, cmds]`, `View`, `hints`, `capturesText`, `commands`. Side effects live in `Cmd`s (`cmds.ts`) that
  dispatch `toTab("<id>", msg)`. No component reads input or the terminal size: the shell's one `useInput` turns
  keys into messages, and sizes come from `ctx` (`bodyColumns`, `bodyRows`).
- **Tabs talk through `AppMsg`s** (`app/switchTab`, `app/openLabels`, `app/confirm`, `app/toast`, `app/load`,
  `app/values`, `app/runFinished`), never by importing each other's models. A shared piece (the presets editor)
  exports a pure API another tab embeds in its own model.
- **Draw with `src/tui/ui/`.** Every line is built to an exact width (`Line`, `Segments`, `fitText`, `truncate`);
  side-by-side panels get exact widths from `splitWidths`, inner sizes from `panelInner` / `dialogInner` /
  `frameBody`. Nothing may be wider than the terminal: a wrapped row throws off Ink's redraws.
- **Keys that arrive together reach Ink as one input**: the shell splits a burst at its control characters
  (`keyPresses`: `"\t?"` is tab then ?) and a meta key into esc + key, so tabs see one key per message; a run of
  text ending in enter stays whole (a scanner's `"00150603Z\r"`), and `editText` types it and reports `submit`.
  Tests send one key per write unless testing a burst.
- **Heavy work stays off the keystroke path.** The SpoolmanDB catalog has ~6k profiles: index it once per loaded
  array (memoize), never walk it per frame; a blocked event loop makes Ink merge keys (esc+tab arrive as one).

## Checking a screen

`ink-testing-library` frames are what the components draw; a real terminal is what the user sees. After
changing any screen, look at it in a real pseudo-terminal:

```bash
npm run tui:snap -- --cols 80 --rows 24 "wait=Spools" snap=spools key=tab snap=add
npm run tui:snap -- --cols 120 --rows 36 "wait=Spools" key=tab key=tab snap=presets
```

It uses your real HOME (BambuStudio settings, SpoolEase console), so look only: never press `a` on a review or
confirm, never make labels, never change Settings (they save at once). For anything that writes, use a
throwaway HOME: copy `test/fixtures/bambustudio/system` into `$H/.config/BambuStudio/` with a `BambuStudio.conf`,
and run with `HOME=$H` and `--skip-spoolease` (or the stand-in servers in `test/`).

## Tests for a screen change

1. The pure update: `test/tab<Name>*.test.ts`, driving `update()` with `press()` keys and asserting the model and
   the dispatched messages; run cmds against the stand-ins (`test/spooleaseServer.ts`, `test/spoolmanDbServer.ts`,
   `test/bambuStudioSetup.ts`, `test/fakeLp.ts`).
2. The view: `test/tab<Name>View.test.tsx` at 80x24 and 120x36, asserting every line's width.
3. Anything that depends on raw mode, the alternate screen, terminal size, bursts or exit codes:
   `test/tui.e2e.test.ts` (built binary in node-pty; `pressEach`, `waitForScreen`, `resize`).
4. Look at it with `tui:snap` at 80 and 120 columns: column bugs only show when something is cut.
