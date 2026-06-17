import type { EditorAction } from "@taleweaver/core";
import type { NavIntent } from "./nav/nav-intent";

/**
 * The key map's result: a geometry-free core `EditorAction`, OR a geometric
 * `NavIntent` the controller resolves against the driver-built layoutTree before
 * dispatching a `SET_SELECTION` / `DELETE_RANGE` to core (Phase 0b — the 7 nav
 * handlers live in the backend, not core's reducer). The controller's keydown
 * path discriminates: a `NavIntent` goes through `resolveNavIntent`, everything
 * else dispatches straight to core.
 */
export type KeyResult = EditorAction | NavIntent;

/** The `NavIntent` type discriminators `mapKeyEvent` may return (Phase 0b). */
const NAV_INTENT_TYPES: ReadonlySet<string> = new Set([
  "MOVE_CURSOR",
  "EXPAND_SELECTION",
  "MOVE_LINE",
  "EXPAND_LINE",
  "MOVE_LINE_BOUNDARY",
  "EXPAND_LINE_BOUNDARY",
  "DELETE_LINE",
]);

/** True when a `mapKeyEvent` result is a geometric `NavIntent` (vs a core action). */
export function isNavIntent(result: KeyResult): result is NavIntent {
  return NAV_INTENT_TYPES.has(result.type);
}

/**
 * Document context the keymap needs for context-sensitive chords. Optional so
 * callers that don't supply it get the non-list behavior (Tab unmapped).
 */
export interface KeyContext {
  /**
   * True when the caret's focus block is a `list-item`. Enables Tab / Shift+Tab
   * to nest / un-nest the list (LIST_INDENT / LIST_OUTDENT); outside a list-item
   * Tab is left unmapped (its current behavior).
   */
  readonly inListItem?: boolean;
}

/** Map a KeyboardEvent to a core `EditorAction` / geometric `NavIntent`, or null. */
export function mapKeyEvent(
  event: KeyboardEvent,
  context: KeyContext = {},
): KeyResult | null {
  const { key: rawKey, ctrlKey, metaKey, altKey, shiftKey } = event;
  // Normalize single printable chars to lowercase: `KeyboardEvent.key` returns
  // the SHIFTED value, so a chord like Ctrl+Shift+X reports `key === "X"`
  // (uppercase) and a raw `=== "x"` compare would never match in a real browser
  // (unit tests that hand-build `key:"x"` mask this). The length-1 guard leaves
  // named keys ("ArrowLeft", "Enter", "Home", …) untouched. Fixes both the new
  // Ctrl+Shift+X chord and the pre-existing Ctrl+Shift+Z (REDO), which had the
  // same latent bug.
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const mod = ctrlKey || metaKey;

  // Undo / Redo
  if (mod && key === "z" && shiftKey) return { type: "REDO" };
  if (mod && key === "z") return { type: "UNDO" };
  if (ctrlKey && key === "y") return { type: "REDO" };

  // Select all
  if (mod && key === "a") return { type: "SELECT_ALL" };

  // Arrow keys (horizontal)
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const boundary = key === "ArrowLeft" ? "start" : "end";
    const direction = key === "ArrowLeft" ? "backward" : "forward";

    // Cmd+Arrow (Mac): line boundary — check metaKey before ctrlKey/altKey
    if (shiftKey && metaKey)
      return { type: "EXPAND_LINE_BOUNDARY", boundary };
    if (metaKey) return { type: "MOVE_LINE_BOUNDARY", boundary };

    if (shiftKey && (ctrlKey || altKey))
      return { type: "EXPAND_WORD", direction };
    if (shiftKey) return { type: "EXPAND_SELECTION", direction };
    if (ctrlKey || altKey) return { type: "MOVE_WORD", direction };
    return { type: "MOVE_CURSOR", direction };
  }

  // Arrow keys (vertical)
  if (key === "ArrowUp" || key === "ArrowDown") {
    const boundary = key === "ArrowUp" ? "start" : "end";
    const direction = key === "ArrowUp" ? "up" : "down";

    // Cmd+Arrow (Mac): document boundary — check metaKey before plain
    if (shiftKey && metaKey)
      return { type: "EXPAND_DOCUMENT_BOUNDARY", boundary };
    if (metaKey) return { type: "MOVE_DOCUMENT_BOUNDARY", boundary };

    if (shiftKey) return { type: "EXPAND_LINE", direction };
    return { type: "MOVE_LINE", direction };
  }

  // Home / End — `mod` (Ctrl OR Cmd) maps to document-boundary so both
  // Windows (Ctrl+Home) and Mac (Cmd+Home) reach the same action. Using
  // only ctrlKey here would silently fall through to MOVE_LINE_BOUNDARY
  // on macOS, landing at the start/end of whatever line the focus is on
  // — confusing when a multi-block selection is active.
  if (key === "Home" || key === "End") {
    const boundary = key === "Home" ? "start" : "end";
    if (shiftKey && mod)
      return { type: "EXPAND_DOCUMENT_BOUNDARY", boundary };
    if (mod) return { type: "MOVE_DOCUMENT_BOUNDARY", boundary };
    if (shiftKey) return { type: "EXPAND_LINE_BOUNDARY", boundary };
    return { type: "MOVE_LINE_BOUNDARY", boundary };
  }

  // Backspace — Cmd before Alt before plain
  if (key === "Backspace") {
    if (metaKey) return { type: "DELETE_LINE" };
    if (altKey || ctrlKey) return { type: "DELETE_WORD", direction: "backward" };
    return { type: "DELETE_BACKWARD" };
  }

  // Delete — modifier variants before plain
  if (key === "Delete") {
    if (altKey || ctrlKey) return { type: "DELETE_WORD", direction: "forward" };
    return { type: "DELETE_FORWARD" };
  }

  if (key === "Enter") return { type: "SPLIT_NODE" };

  // Tab / Shift+Tab — context-sensitive (Google Docs):
  //  - In a list-item: nest / un-nest (LIST_INDENT / LIST_OUTDENT). `handleIndent`
  //    deliberately skips list-items, so list nesting routes through
  //    LIST_INDENT/LIST_OUTDENT here rather than INDENT/OUTDENT.
  //  - Outside a list-item: Tab inserts a tab (INSERT_TAB); Shift+Tab is a no-op
  //    (Google Docs has no reverse-tab/outdent for body text).
  if (key === "Tab") {
    if (!context.inListItem) return shiftKey ? null : { type: "INSERT_TAB" };
    return shiftKey ? { type: "LIST_OUTDENT" } : { type: "LIST_INDENT" };
  }

  // Text styling shortcuts
  if (mod && key === "b") return { type: "TOGGLE_STYLE", style: "bold" };
  if (mod && key === "i") return { type: "TOGGLE_STYLE", style: "italic" };
  if (mod && key === "u") return { type: "TOGGLE_STYLE", style: "underline" };
  if (mod && shiftKey && key === "x")
    return { type: "TOGGLE_STYLE", style: "strikethrough" };
  // Clear formatting (Google Docs' Ctrl+\) — removes all inline character
  // formatting from the selection.
  if (mod && key === "\\") return { type: "CLEAR_FORMATTING" };

  // Paragraph alignment (Google Docs: Ctrl+Shift+L/E/R/J). `align` is LOGICAL:
  // L → start, R → end (matches Google Docs' physical L/R in LTR; mirrors under
  // RTL, which is the correct logical behavior). The shifted `key` is already
  // lowercased by the normalization above, so "L" → "l" matches.
  if (mod && shiftKey && key === "l") return { type: "SET_TEXT_ALIGN", align: "start" };
  if (mod && shiftKey && key === "e") return { type: "SET_TEXT_ALIGN", align: "center" };
  if (mod && shiftKey && key === "r") return { type: "SET_TEXT_ALIGN", align: "end" };
  if (mod && shiftKey && key === "j") return { type: "SET_TEXT_ALIGN", align: "justify" };

  // Block-type shortcuts (Google Docs: Ctrl/Cmd+Alt+0 = normal text,
  // Ctrl/Cmd+Alt+1..6 = Heading 1..6). These match `event.code` ("Digit3"),
  // NOT `event.key`: a digit under Shift/AltGr is layout-dependent (Shift+7 is
  // "&" on US; Ctrl+Alt is AltGr on Windows and emits symbols on many layouts),
  // so the physical key code is the only reliable signal.
  // Skip when AltGraph is active: on Windows/EU layouts AltGr is reported as
  // ctrlKey+altKey, so `mod && altKey` would match AltGr+digit — which produces a
  // CHARACTER on many layouts (German AltGr+8 = "[", AltGr+9 = "]") — and `preventDefault`
  // in the controller would EAT that character while changing the block type instead.
  // Treat AltGr as not-a-mod for this chord (Google Docs does the same).
  if (mod && altKey && !event.getModifierState("AltGraph") && event.code.startsWith("Digit")) {
    const n = Number(event.code.slice(5));
    if (n === 0) return { type: "SET_BLOCK_TYPE", blockType: "paragraph" };
    if (n >= 1 && n <= 6)
      return { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: n } };
  }
  // List shortcuts (Google Docs: Ctrl/Cmd+Shift+7 = numbered, +8 = bulleted).
  if (mod && shiftKey && event.code === "Digit7") return { type: "TOGGLE_LIST", listType: "ordered" };
  if (mod && shiftKey && event.code === "Digit8") return { type: "TOGGLE_LIST", listType: "unordered" };

  return null;
}
