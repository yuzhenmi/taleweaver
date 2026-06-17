import type { EditorAction } from "@taleweaver/core";

export interface KeyContext {
  /** macOS uses Cmd (metaKey) for chords; other platforms use Ctrl (ctrlKey). */
  readonly mac: boolean;
  /**
   * True when the caret's focus block is a `list-item`. Makes Tab / Shift+Tab nest / un-nest the
   * list (LIST_INDENT / LIST_OUTDENT) instead of inserting a tab. Defaults to non-list behavior.
   */
  readonly inListItem?: boolean;
}

/** The primary chord modifier for the platform (Cmd on mac, Ctrl elsewhere). */
function primaryMod(e: KeyboardEvent, ctx: KeyContext): boolean {
  return ctx.mac ? e.metaKey : e.ctrlKey;
}

/**
 * THIN digital-local chord map (spec C5/F4): only the NON-NAV chords digital dispatches. Returns
 * null for every nav key (arrows / Home / End / PageUp / PageDown), every plain printable key, and
 * Backspace/Delete/Enter — the browser owns caret movement and `beforeinput` owns insertion/delete.
 * Deliberately does NOT reuse the print `mapKeyEvent` (which returns NavIntent and transitively
 * imports geometry — breaking the `digital ↛ layout` boundary).
 */
export function mapDigitalKey(e: KeyboardEvent, ctx: KeyContext): EditorAction | null {
  const mod = primaryMod(e, ctx);
  const key = e.key.toLowerCase();

  if (e.key === "Escape") return { type: "ESCAPE" };
  // Tab / Shift+Tab are context-sensitive (Google Docs; mirrors print's `mapKeyEvent` branch form):
  //  - Outside a list: plain Tab inserts a tab (INSERT_TAB); Shift+Tab is a no-op — Google Docs
  //    has no reverse-tab/outdent for body text.
  //  - In a list-item: nest / un-nest the list (LIST_INDENT / LIST_OUTDENT).
  if (e.key === "Tab") {
    if (!ctx.inListItem) return e.shiftKey ? null : { type: "INSERT_TAB" };
    return e.shiftKey ? { type: "LIST_OUTDENT" } : { type: "LIST_INDENT" };
  }

  if (!mod) return null; // everything below requires the primary chord modifier

  switch (key) {
    case "b":
      return { type: "TOGGLE_STYLE", style: "bold" };
    case "i":
      return { type: "TOGGLE_STYLE", style: "italic" };
    case "u":
      return { type: "TOGGLE_STYLE", style: "underline" };
    case "x":
      return e.shiftKey ? { type: "TOGGLE_STYLE", style: "strikethrough" } : null;
    case "\\":
      return { type: "CLEAR_FORMATTING" };
    case "a":
      return { type: "SELECT_ALL" };
    case "z":
      return e.shiftKey ? { type: "REDO" } : { type: "UNDO" };
    case "y":
      return { type: "REDO" };
    default:
      return null;
  }
}
