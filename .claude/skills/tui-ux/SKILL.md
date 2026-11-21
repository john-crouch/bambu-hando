---
name: tui-ux
description: Interaction and layout rules for bambu-hando's Ink TUI (src/tui/), and how to check a screen the way a real terminal shows it. Use before adding or changing any TUI screen, key binding, menu, column layout or TUI test.
---

# bambu-hando TUI: UX rules and workflow

The TUI is for adding a spool without typing. Every screen offers choices; text entry is the exception.

## Interaction rules

- **Choose, don't type.** Offer a list built from what bambu-hando can already read: BambuStudio's folders and printers, the SpoolmanDB catalog, SpoolEase's spool catalog, `lpstat -e`, remembered choices. Free text only where no list can exist (a new file path, an unlisted host), and then as the last item of a list ("Other…"), not as the default.
- **Preselect what the user picked last.** Remember choices in `configDir()` JSON (`labelSettings.ts`, `tuiSettings.ts` pattern: atomic write, damaged or unknown values fall back to defaults) and put the cursor on them.
- **Same keys everywhere.** ↑/↓ move · enter choose or continue · esc back one screen · space toggles a checkbox · ctrl+c quits from anywhere. Letters jump to the next item starting with them in plain lists. Where letters type a search (the picker), tab selects instead of space. Summary screens use single letters (`a`, `b`, `l`, `q`) and say so.
- **Every screen ends with a dim hint line** listing its keys, and the `back` hint names the screen it returns to.
- **Never lose work going back.** Selections, weight choices and form values survive esc and `b`.
- **Every summary leads back to the menu** with `m`, and the menu says what the run did (`outcome`). Quitting later keeps a failed run's exit code.
- **Waiting shows `Busy`** (spinner + message), never bare text.
- **Show colors as swatches**: `ChoiceItem.swatch` ("#RRGGBB") in lists, `backgroundColor` cells in tables.
- **Unlisted values go last as "Other…"** and open a small form that copies from a listed one, so only the differing fields are typed.
- **A new list starts a new type-ahead:** reset `typed` whenever the rows change level.
- **Show the consequence before acting.** Nothing writes until the plan screen's `a`; the plan names every target (preset folder, printers, console) and, per row, what happens to it (`planPreview.ts`). Any other screen that writes (preset IDs, copies) lists each target first and waits for `a`.
- **`?` opens the screen's help page** (`Help.tsx` `helpPage`, one topic per screen; add one for a new screen, it's tested to fit 80 columns). Hints stay short and end in `? help`; rare keys (type-ahead, ctrl+a, paging) live in the help page. In a free-text field `?` is typed instead (`formTyping`, `colorFormTyping`, `labelFormTyping`), and that screen's hint drops `? help` while it is.

## Code rules

- `App.tsx` is a screen state machine with one `useInput` that is always active and branches on `screen.name`. Never toggle `isActive`: re-attaching the listener after a screen change drops keys pressed right away.
- Use only display components from `@inkjs/ui` (`Badge`, `Spinner`, `ProgressBar`, `StatusMessage`, styled through `theme.ts`): its inputs (`Select`, `TextInput`, `ConfirmInput`…) register their own `useInput`.
- A screen's key handling is a pure function returning an action (`pickerInput`, `weightInput`, `labelFormInput`); its component only renders. Unit-test the pure function without rendering.
- Columns: give each cell a fixed width with `paddingRight={1}` and `wrap="truncate-end"`, so a cut value ends in `…` and keeps a gap. Size label columns from the longest label, not a constant.
- Ambiguous-width characters (`™`, `°`, `·`, `…`) are measured as two columns by Ink and drawn as one by most terminals. Leave a spare column wherever a header or value may contain one.
- **Every fixed-width box gets `flexShrink={0}`** (cursor, marks, swatches, label columns). A row cut with `…` is measured a column too wide and Yoga takes the difference from whichever box can shrink, so a row starts a column early. Let exactly one column shrink on a narrow terminal (a name), and cut it with `truncate-end`. When two must give way, compute whole widths from the terminal's columns (`fitColumns`, `useTerminalColumns`) instead of letting Yoga split the shrink.
- **Size scrolling lists from the terminal** (`screenSize.ts` `listRows`, `useTerminalRows`): count the screen's other lines as its `CHROME`, plus a spare one, pass `height` to the component and the same rows to its input function for paging, and add the screen to `test/screenFit.test.tsx`.
- **Keys that arrive together reach the app as one input** (`"s\r"`, a scanner's `"00150603Z\r"`): Ink splits only at escape sequences and backspaces. Text entry that may get a burst splits it at `\r`/`\n` (`scanInput`); tests and PTY tests send one key per write (`pressEach`) unless testing a burst.

## Checking a screen

`ink-testing-library` frames do not match a real terminal for wide or ambiguous characters. After changing any screen, look at it in a real pseudo-terminal:

```bash
npm run tui:snap -- "wait=ctrl+c quit" snap=menu key=enter wait=SpoolmanDB: "type=polylite petg" snap=picker -- --source spoolmandb
```

It uses your real HOME (BambuStudio settings, SpoolEase console), so stop before the plan's `a` unless the run is meant to write. Use the fixture source with `--skip-spoolease` for anything that must not touch the console.

## Tests for a screen change

1. Pure input function: unit test (`test/<screen>.test.ts`).
2. Screen behavior in `test/tui.test.tsx` (`ink-testing-library`, `settle()` between keys, `vi.waitFor` on `lastFrame()`).
3. Anything that depends on raw mode, the cursor, terminal size, input bursts or exit codes in `test/tui.e2e.test.ts` (built binary in node-pty; `pressEach` for one key per write, `resize` for a resize).
4. Check the screen with `tui:snap` at 80 columns as well as the default 110 (`--cols 80 --rows 24`): column bugs only show when something is cut.
