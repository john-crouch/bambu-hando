// ABOUTME: The design system's public surface: every component and the pure helpers tab updates call.
// ABOUTME: Tabs import from here; each module's own file has the details.

export { Bar, barCells, barSegments } from "./Bar.js";
export { Busy } from "./Busy.js";
export { consoleUrl, LinkedText, partsText, type TextPart } from "./ConsoleLink.js";
export { Detail, type DetailRow, labelColumn } from "./Detail.js";
export { DIALOG_WIDTH, Dialog, dialogInner } from "./Dialog.js";
export { Empty } from "./Empty.js";
export { Footer, footerSegments } from "./Footer.js";
export { FRAME_CHROME, Frame, frameBody } from "./Frame.js";
export * from "./format.js";
export { type ConsoleState, Header, type HeaderStatus, type HeaderTab } from "./Header.js";
export { fitHints, hintSegments } from "./hints.js";
export { Line, Segments } from "./Line.js";
export { List } from "./List.js";
export {
  type Cell,
  filterRows,
  type ListRow,
  listPosition,
  listWindow,
  matchRanges,
  moveCursor,
  type Range,
  typeAhead,
} from "./list.js";
export { type Page, PageBar } from "./PageBar.js";
export { Panel, panelInner, splitWidths } from "./Panel.js";
export { Swatch } from "./Swatch.js";
export { TextField } from "./TextField.js";
export { APP_NAME, TITLE, Title } from "./Title.js";
export { type Toast, ToastLine, toastSegments } from "./Toast.js";
export { fitText, type Segment, textWidth, truncate } from "./text.js";
export { editText, type TextEdit, type TextState } from "./textField.js";
export { COLORS, GRADIENT, ICONS, type Tone, theme, toneColor } from "./theme.js";
