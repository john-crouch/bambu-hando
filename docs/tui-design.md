# bambu-hando TUI design

The TUI is where you look after your filament: what's on the console, what's running low, what's out of
sync, and adding more. It's a full-screen app with a fixed frame, tabs for places and pages inside each
tab, and every action shows its consequence before it writes.

## Principles

1. **One frame.** Header, body, footer, filling the terminal (alternate screen) and following resizes.
   Nothing scrolls the terminal; long lists scroll inside their panel.
2. **Places, not sequences.** Five tabs are always visible. Inside a tab, pages (steps or sections) are
   shown as a page bar. You always see where you are and can go anywhere.
3. **Show, then act.** Lists come with a detail panel for the highlighted item, and that panel says what an
   action would change. Writes happen only from a review page or a confirm dialog that names every target.
4. **Never lose work.** Each tab keeps its state when you switch away: selection, filters, drafts, cursor.
5. **Same keys everywhere.** The footer lists the keys that work right now; `?` lists all of them;
   `ctrl+k` finds any action by name.
6. **Your data first.** The landing tab is your spools: what's left, what's low, and whether everything is
   in sync, with the actions you need on a spool.
7. **Quiet chrome, loud data.** Borders and labels are dim; accent color marks focus and selection only;
   other color always means something (a status, a swatch, a warning).

## Frame

```
 bambu-hando   Spools   Add   Presets   Check   Settings        ✓ SpoolEase 10.0.24.111 · X1C 0.6
╭ Spools · 14 on the console ─────────────────────────────╮╭ #14 ─────────────────────────────────╮
│ 14 spools · 9.8 kg left · 3 low · sync ✓                 ││ ████████████████████████████████████ │
│                                                          ││ Sunlu PETG 2.0 Vivid Yellow          │
│▌[ ] ██ #14 Sunlu PETG 2.0 Vivid Yellow  564 g ▰▰▰▰▰▱▱▱▱▱ ││ PETG · Sunlu · P4840583              │
│ [ ] ██ #13 OVERTURE PLA Basic White     120 g ▰▱▱▱▱▱▱▱▱▱ ││                                      │
│ [ ] ██ #12 OVERTURE PETG Basic Black    871 g ▰▰▰▰▰▰▰▰▰▱ ││ Left      564 g of 1000 g   56%      │
│  …                                                       ││ Empty     236 g spool               │
│                                                    3/14  ││ Location  AMS 1 · slot 2            │
╰──────────────────────────────────────────────────────────╯╰──────────────────────────────────────╯
 ↑↓ move  space tick  / filter  s sort  l label  + more like this  b scan  tab next tab  ? help
```

- **Header** (1 line): gradient name; the tabs, the active one as an accent pill; on the right, the
  console's live state (`✓` reachable, `✗` unreachable, a spinner while checking, `-` skipped) and the
  printer the next run writes for.
- **Body**: the tab. Most tabs are a list panel and a detail panel side by side; below 90 columns the
  detail panel moves under the list or opens with `enter`.
- **Footer** (1 line): the keys for the focused context, `key` in accent and its meaning dim: the
  tab's at the left (its primary keys kept first when narrow), the global ones at the right end as
  `ctrl+k commands  tab next tab  ? help  q quit`. When narrow the global keys give way in that order
  from the left, always the same way (ctrl+k, then tab, then q); `? help` is never dropped. A toast
  ("✓ 3 labels sent to DYMO") takes the body's whole last row on a quiet bar for a few seconds, so it
  never pushes keys out and nothing under it shows beside it.
- **Dialogs**: help (`?`), the command palette (`ctrl+k`), confirm dialogs and a tab's own dialogs (a
  count, a barcode, an unlisted color) and the labels form draw as a centered bordered panel over the
  body, which goes gray and dim behind it. A tab never draws a dialog inside its View: it returns it
  from `dialog(model, ctx)` and the shell draws it in the frame's dialog layer; a shell overlay opened
  on top dims the tab's dialog too. Every dialog floats in a halo of one blank cell, so the body never
  runs into its border; one with under 16 free columns (`dialogWidth`) takes the body's whole width
  instead, so no sliver of the body shows beside it, and `dialogRows` is the height that leaves the
  halo's rows. Dialog text wraps; it is never cut.

## Keys

| Key | Meaning |
|---|---|
| `tab` / `shift+tab` | next / previous tab |
| `←` / `→` | previous / next page inside the tab (steps, sections, editor groups) |
| `↑` `↓` `pgup` `pgdn` `home` `end` | move in the focused list |
| letters | jump to the next item starting with them (type-ahead), in plain lists |
| `/` | filter or search the focused list; typing then goes to the filter, `esc` clears it |
| `space` | tick or untick |
| `enter` | open, choose, continue |
| `esc` | back: close an overlay, clear a filter, go up a level, previous page |
| `a` | apply on a review page or confirm dialog |
| `?` | help for where you are |
| `ctrl+k` | command palette |
| `q` | quit (outside text fields) · `ctrl+c` quits from anywhere |

Text fields take every printable key, so `q`, `?` and letters type there; the footer says so.

A tab's own dialog (`modal`, drawn from `dialog`) and an overlay take every key but ctrl+c, `q` and
`tab` included; the footer then shows only their keys, and dialogs draw no key line of their own (one
place for keys).
`q` with unsaved changes in any tab (`unsaved`) asks "Quit and drop N unsaved changes?" (`q`/`a` quit,
`esc` stays); a write in progress (`busy`) still refuses to quit.

**Escape merged with the next key.** Ink 8 holds a lone ESC for 20 ms to tell it from the start of an
escape sequence; when the next key's bytes are read in the same chunk (a busy event loop, a fast
typist), it reports one meta key: `ESC q` is meta+q, `ESC ESC[B` is meta+down, and the esc is gone.
Nothing in the TUI binds alt+key, so the shell splits any meta key back into `esc` and the key (sent
after esc's own commands, so an overlay esc closes is gone before the key lands). The exception is a
word move in a text field (meta ←, →, backspace), kept whole while a tab takes text or an overlay is
open. Two merged keys in one read can still land out of order; that takes a stall long enough for
both, and hasn't been seen.

## Tabs

### Spools (landing when a console is set up)
List of the console's spools (swatch, ID, name, left with a bar, location), summary line on top (count,
total left, low, sync state from the check). Detail: big swatch, name, material/brand/code, weights, tag,
location, added, temperatures from the custom-filament row. Actions: `l` labels (ticked spools, else the
highlighted one), `+` more spools like this one (count dialog, then confirm), `b` scan a barcode (known
barcode → count; new → choose the filament, learned), `s` sort, `/` filter, `r` reload. Without a console:
an empty state that sends you to Settings.

### Add (landing without a console, or when started with --brand/--material/--match/--source)
Pages: **Find → Weights → Review → Done**, in a page bar (Weights only when spools are created and a
brand has several empty-spool weights). Find drills SpoolmanDB brand → material → color with `enter`/`esc`;
the detail panel previews the next level, or the filament and what saving adds; `/` searches the whole
catalog by name; `space` ticks; a tray line shows what's ticked across brands. "Other color…" ends each
color list. An imported file or URL source is a root entry beside SpoolmanDB. Review names every target
(preset folder, printers, console) and shows per row what happens; `e` edits a row's preset before it's
written; `a` runs. The run streams statuses into the same table with a progress bar; Done summarizes and
offers labels for the new spools.

### Presets
List of your BambuStudio filament presets (grouped by filament ID), detail with key settings, file and
the presets sharing its ID. `enter` opens the editor: pages per setting group, then all settings as raw
text; changed values marked; `a` goes to the review (which presets to save to, the SpoolEase nozzle range
when it changes), `a` again writes.

### Check
The sync check as pages (Presets · Custom filaments · Spools), each with a count of problems, rows with
what's wrong and how to fix it. `f` gives filament IDs to presets without one (review, then `a`). `r`
checks again.

### Settings
Pages: BambuStudio (preset folder, printers, overwrite) · SpoolEase (host, port, key, HTTPS, skip, create
spools, `t` tests the connection) · Labels (printer, size, fields) · Import (file or URL, diameter).
Lists for every value that can come from a list; text only where nothing can.

## Architecture (Bubble Tea's, in Ink)

- `program.ts`: a model/update/view runtime. `update(model, msg) → [model, cmds]` is pure; a `Cmd` is an
  async function that may dispatch messages (one, or a stream, as a sync run does). Keys, loaded data and
  run events are all messages.
- `App.tsx`: the one `useInput`, turning Ink keys into `key` messages; global keys (tabs, help, palette,
  quit); routes the rest to the active tab or the open overlay; renders the frame.
- `tabs/<tab>/`: each tab is a module: `init`, `update`, `View`, `hints(model)` (the footer and help come
  from the same hints). No tab registers input.
- `ui/`: the design system: `Frame`, `Header`, `Footer`, `Panel`, `List` (highlight bar, ticks, swatches,
  scroll position, match highlighting), `Detail` (label/value rows), `PageBar`, `Dialog`, `Swatch`,
  `Busy`, `Empty`, `TextField`.
- Data (`resources`): console spools and custom filaments, presets, the SpoolmanDB catalog, the sync
  check. Loaded in the background after the first frame, shown loading/failed inline in the panel that
  needs them, reloaded after any write that changes them.
- Exit codes are those of the headless CLI: 0, 1 when a run in the session failed, 2 for setup errors,
  130 for ctrl+c. The alternate screen is cleared on exit, so `run.tsx` prints the session's run
  summaries to the normal screen after it.

## Look

- Palette (`ui/theme.ts`): accent `#A06BFF`, accent 2 `#FF5F87` (keys, the title gradient), ok green,
  warning yellow, failed red, muted gray; selection bar `#3B2F5C` behind bright text.
- Rounded borders, dim; the focused panel's border and title in accent.
- Ink 8 measures `✓ ✗ ▰ ▱ ▸ ╭ ─ ° · …` as one column, as terminals draw them, so they're fine in fixed-width
  cells and in panel title lines; still check every screen with `tui:snap` at 80 and 110 columns.
- Values for people: `220°C` (or `190–230°C`), `564 g`, `56%`, dates as `2026-10-30`; codes and IDs in
  the detail panel, dim.

## Design system API (`src/tui/ui/`)

Every component is render-only (no hooks that read input). Sizes come from props (the shell knows the
terminal), so components render the same in tests and in a terminal.

| Component | Props | Draws |
|---|---|---|
| `theme.ts` | `COLORS` (`accent`, `accent2`, `ok`, `warning`, `failed`, `muted`, `selection`, `selectionText`, `border`), `GRADIENT`, the `@inkjs/ui` theme | colors only |
| `Frame` | `columns`, `rows`, `header`, `footer`, `dialog?`, `overlay?`, `toast?`, `children` | full-screen column: header, body (flex), footer; the tab's dialog, then the shell's overlay, draw centered over the dimmed body in a one-cell blank halo; the toast is the body's last row |
| `Header` | `tabs: {id,title,badge?}[]`, `active`, `status: {console: "ok"\|"failed"\|"checking"\|"skipped", consoleText, printerText}`, `columns` | gradient name, tab pills (active in accent background), right-aligned status |
| `Footer` | `hints: Hint[]`, `global?: Hint[]`, `columns` | `key` accent, label dim, two spaces apart; the tab's hints (primary first) when narrow; global hints at the right end, dropped from the left (`fitGlobal`), primary never |
| `Panel` | `title`, `subtitle?`, `focused?`, `width?`, `height?`, `grow?`, `children`, `footerRight?` (e.g. "12/41") | rounded border; title and subtitle inside the top border line (`╭ Title · sub ───╮`), accent when focused, dim otherwise; footerRight inside the bottom border |
| `List` | `rows: ListRow[]`, `cursor`, `height`, `width`, `marker?: "check" \| "radio" \| "none"`, `highlight?: string` (filter text to highlight) | scrolling rows with the cursor row as a full-width selection bar, `[✓]`/`[ ]` ticks, or for one-of choices `●` on the chosen (ticked) row and `○` on the rest; swatch cells, columns; keeps the cursor in view; `listWindow(cursor, count, height)` exported pure |
| `ListRow` | `{ key, cells: Cell[], ticked?, swatch?: "#RRGGBB", dim?, tone? }`, `Cell = { text, width?: number, grow?: boolean, align?: "left"\|"right", color?, dim? }` | one cell per column; exactly one `grow` cell takes the remaining width and is cut with `…` |
| `Detail` | `rows: {label, value, tone?, dim?}[]`, `labelWidth?` | aligned label/value lines |
| `Swatch` | `color`, `width`, `height?` | a block of the color (background-colored spaces) |
| `PageBar` | `pages: {id,title,state: "done"\|"current"\|"todo"\|"disabled", badge?}[]` | `✓ Find ─ ▸ Weights ─ Review`, current in accent |
| `Dialog` | `title`, `width?`, `note?`, `children` | a bordered box in accent (gray and dim on a backdrop), painted opaque; its keys go in the footer; `dialogWidth(columns, wanted)`, `dialogRows(rows)`, `dialogInner(width)` size it |
| `Toast` | `toast: {text, tone?}`, `width` | the toast as one whole row on the toast bar, icon from the tone |
| `TextField` | `value`, `cursor`, `focused`, `placeholder?`, `mask?`, `width` | an input line with a visible cursor; pure helpers `editText(state, key)` for typing, backspace, ←/→, home/end, delete, bursts |
| `Busy` | `message` | spinner + message (existing API) |
| `Empty` | `title`, `lines`, `action?: Hint` | a centered empty state saying what to do |
| `Bar` | `fraction`, `width`, `tone?` | `▰▰▰▱▱` with the tone's color |
| `Badge` (from @inkjs/ui) | status badges (`WRITTEN`, `FAILED`, …) as today | |

Pure helpers live beside their component and are what tab updates call: `listWindow`, `moveCursor(cursor,
key, count, pageRows)` (↑↓ pgup pgdn home end, no wrap), `typeAhead(labels, cursor, letter)`,
`filterRows(labels, text)` (words in any order, case-insensitive, returns match ranges for `highlight`),
`editText`, `wrapText(text, width)` (words, never cut). `format.ts` spells values one way: `formatTemp`,
`formatRange`, `formatGrams`, `shortPrinter`, `plural`, and `fitPath(path, width)` (HOME as `~`, folders
cut from the middle so the file name stays: `~/…/base/Polymaker PETG @X1C 0.4.json`).
