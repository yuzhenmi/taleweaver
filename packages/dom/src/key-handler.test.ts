import { describe, it, expect } from "vitest";
import { mapKeyEvent } from "./key-handler";

function key(overrides: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: overrides.key,
    code: overrides.code ?? "",
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    altKey: overrides.altKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
  });
}

describe("mapKeyEvent", () => {
  it("returns null for printable characters (handled by textarea input)", () => {
    expect(mapKeyEvent(key({ key: "a" }))).toBeNull();
    expect(mapKeyEvent(key({ key: " " }))).toBeNull();
    expect(mapKeyEvent(key({ key: "Z" }))).toBeNull();
  });

  it("maps Backspace to DELETE_BACKWARD", () => {
    expect(mapKeyEvent(key({ key: "Backspace" }))).toEqual({
      type: "DELETE_BACKWARD",
    });
  });

  it("maps Enter to SPLIT_NODE", () => {
    expect(mapKeyEvent(key({ key: "Enter" }))).toEqual({
      type: "SPLIT_NODE",
    });
  });

  it("maps ArrowLeft to MOVE_CURSOR backward", () => {
    expect(mapKeyEvent(key({ key: "ArrowLeft" }))).toEqual({
      type: "MOVE_CURSOR",
      direction: "backward",
    });
  });

  it("maps ArrowRight to MOVE_CURSOR forward", () => {
    expect(mapKeyEvent(key({ key: "ArrowRight" }))).toEqual({
      type: "MOVE_CURSOR",
      direction: "forward",
    });
  });

  it("maps Alt+ArrowLeft to MOVE_WORD backward", () => {
    expect(mapKeyEvent(key({ key: "ArrowLeft", altKey: true }))).toEqual({
      type: "MOVE_WORD",
      direction: "backward",
    });
  });

  it("maps Ctrl+ArrowRight to MOVE_WORD forward", () => {
    expect(mapKeyEvent(key({ key: "ArrowRight", ctrlKey: true }))).toEqual({
      type: "MOVE_WORD",
      direction: "forward",
    });
  });

  it("maps Cmd+Z to UNDO (macOS)", () => {
    expect(mapKeyEvent(key({ key: "z", metaKey: true }))).toEqual({
      type: "UNDO",
    });
  });

  it("maps Ctrl+Z to UNDO", () => {
    expect(mapKeyEvent(key({ key: "z", ctrlKey: true }))).toEqual({
      type: "UNDO",
    });
  });

  it("maps Cmd+Shift+Z to REDO (macOS)", () => {
    expect(
      mapKeyEvent(key({ key: "z", metaKey: true, shiftKey: true })),
    ).toEqual({ type: "REDO" });
  });

  it("maps Ctrl+Shift+Z to REDO", () => {
    expect(
      mapKeyEvent(key({ key: "z", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "REDO" });
    // Real browsers report the SHIFTED key "Z" (uppercase) when Shift is held —
    // the chord must still map (regression guard for the case-normalization).
    expect(
      mapKeyEvent(key({ key: "Z", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "REDO" });
  });

  it("maps the real-browser uppercase Ctrl+Shift+X to strikethrough", () => {
    // With Shift held the browser sets key to "X" (uppercase); the chord must
    // still fire (a lowercase-only `=== \"x\"` compare would silently miss it).
    expect(
      mapKeyEvent(key({ key: "X", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "TOGGLE_STYLE", style: "strikethrough" });
    expect(
      mapKeyEvent(key({ key: "X", metaKey: true, shiftKey: true })),
    ).toEqual({ type: "TOGGLE_STYLE", style: "strikethrough" });
  });

  it("maps the real-browser uppercase Ctrl+Shift+L/E/R/J to alignment", () => {
    // Browser sends the uppercase letter when Shift is held; the chord must
    // still fire after normalization. `align` is logical (L→start, R→end).
    expect(
      mapKeyEvent(key({ key: "L", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "SET_TEXT_ALIGN", align: "start" });
    expect(
      mapKeyEvent(key({ key: "E", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "SET_TEXT_ALIGN", align: "center" });
    expect(
      mapKeyEvent(key({ key: "R", metaKey: true, shiftKey: true })),
    ).toEqual({ type: "SET_TEXT_ALIGN", align: "end" });
    expect(
      mapKeyEvent(key({ key: "J", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "SET_TEXT_ALIGN", align: "justify" });
  });

  it("does not map the alignment letters without the modifier+shift", () => {
    // Bare/Shift-only/mod-only must NOT trigger alignment (would clobber typing).
    expect(mapKeyEvent(key({ key: "l" }))).toBeNull();
    expect(mapKeyEvent(key({ key: "L", shiftKey: true }))).toBeNull();
    expect(mapKeyEvent(key({ key: "j", ctrlKey: true }))).toBeNull();
  });

  it("maps Ctrl/Cmd+Alt+0..6 (by event.code) to block-type shortcuts", () => {
    // Uses event.code (not key) — a digit under AltGr is layout-dependent.
    // The `key` here is deliberately a wrong/symbol value to prove code wins.
    expect(
      mapKeyEvent(key({ key: "0", code: "Digit0", ctrlKey: true, altKey: true })),
    ).toEqual({ type: "SET_BLOCK_TYPE", blockType: "paragraph" });
    expect(
      mapKeyEvent(key({ key: "1", code: "Digit1", ctrlKey: true, altKey: true })),
    ).toEqual({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
    expect(
      mapKeyEvent(key({ key: "§", code: "Digit6", metaKey: true, altKey: true })),
    ).toEqual({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 6 } });
  });

  it("does NOT fire the block-type chord when AltGraph is active (AltGr+digit passes through)", () => {
    // On Windows/EU layouts AltGr is reported as ctrlKey+altKey AND
    // getModifierState("AltGraph") === true; e.g. Spanish AltGr+3 produces "#"
    // (Digit3 is in the 0..6 heading range, so WITHOUT the guard this wrongly
    // fires SET_BLOCK_TYPE heading 3 and the controller preventDefault-eats the
    // "#"). The chord must NOT match — controller-audit #3.
    const e = key({ key: "#", code: "Digit3", ctrlKey: true, altKey: true });
    Object.defineProperty(e, "getModifierState", {
      value: (m: string) => m === "AltGraph",
      configurable: true,
    });
    expect(mapKeyEvent(e)).toBeNull();
  });

  it("maps Ctrl/Cmd+Shift+7|8 (by event.code) to list shortcuts", () => {
    expect(
      mapKeyEvent(key({ key: "&", code: "Digit7", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "TOGGLE_LIST", listType: "ordered" });
    expect(
      mapKeyEvent(key({ key: "*", code: "Digit8", metaKey: true, shiftKey: true })),
    ).toEqual({ type: "TOGGLE_LIST", listType: "unordered" });
  });

  it("does not fire block-type/list digit shortcuts without the right modifiers", () => {
    // Digit alone (textarea input), or wrong modifier set, must NOT map.
    expect(mapKeyEvent(key({ key: "1", code: "Digit1" }))).toBeNull();
    expect(mapKeyEvent(key({ key: "1", code: "Digit1", ctrlKey: true }))).toBeNull(); // no alt
    expect(mapKeyEvent(key({ key: "7", code: "Digit7", ctrlKey: true }))).toBeNull(); // no shift
    expect(mapKeyEvent(key({ key: "9", code: "Digit9", ctrlKey: true, altKey: true }))).toBeNull(); // out of range
  });

  it("maps Ctrl+Y to REDO", () => {
    expect(mapKeyEvent(key({ key: "y", ctrlKey: true }))).toEqual({
      type: "REDO",
    });
  });

  it("returns null for Ctrl+printable (non-shortcut)", () => {
    expect(mapKeyEvent(key({ key: "x", ctrlKey: true }))).toBeNull();
  });

  it("returns null for Meta+printable (non-shortcut)", () => {
    expect(mapKeyEvent(key({ key: "x", metaKey: true }))).toBeNull();
  });

  it("returns null for unrecognized keys", () => {
    expect(mapKeyEvent(key({ key: "F1" }))).toBeNull();
    expect(mapKeyEvent(key({ key: "Escape" }))).toBeNull();
  });

  // --- Delete forward ---

  it("maps Delete to DELETE_FORWARD", () => {
    expect(mapKeyEvent(key({ key: "Delete" }))).toEqual({
      type: "DELETE_FORWARD",
    });
  });

  // --- Selection expansion (Shift+Arrow) ---

  it("maps Shift+ArrowRight to EXPAND_SELECTION forward", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowRight", shiftKey: true })),
    ).toEqual({ type: "EXPAND_SELECTION", direction: "forward" });
  });

  it("maps Shift+ArrowLeft to EXPAND_SELECTION backward", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowLeft", shiftKey: true })),
    ).toEqual({ type: "EXPAND_SELECTION", direction: "backward" });
  });

  it("maps Shift+Ctrl+ArrowRight to EXPAND_WORD forward", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowRight", shiftKey: true, ctrlKey: true })),
    ).toEqual({ type: "EXPAND_WORD", direction: "forward" });
  });

  it("maps Shift+Alt+ArrowLeft to EXPAND_WORD backward", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowLeft", shiftKey: true, altKey: true })),
    ).toEqual({ type: "EXPAND_WORD", direction: "backward" });
  });

  // --- Vertical arrows ---

  it("maps ArrowUp to MOVE_LINE up", () => {
    expect(mapKeyEvent(key({ key: "ArrowUp" }))).toEqual({
      type: "MOVE_LINE",
      direction: "up",
    });
  });

  it("maps ArrowDown to MOVE_LINE down", () => {
    expect(mapKeyEvent(key({ key: "ArrowDown" }))).toEqual({
      type: "MOVE_LINE",
      direction: "down",
    });
  });

  it("maps Shift+ArrowUp to EXPAND_LINE up", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowUp", shiftKey: true })),
    ).toEqual({ type: "EXPAND_LINE", direction: "up" });
  });

  it("maps Shift+ArrowDown to EXPAND_LINE down", () => {
    expect(
      mapKeyEvent(key({ key: "ArrowDown", shiftKey: true })),
    ).toEqual({ type: "EXPAND_LINE", direction: "down" });
  });

  // --- Text styling shortcuts ---

  it("maps Cmd+B to TOGGLE_STYLE bold", () => {
    expect(mapKeyEvent(key({ key: "b", metaKey: true }))).toEqual({
      type: "TOGGLE_STYLE",
      style: "bold",
    });
  });

  it("maps Ctrl+B to TOGGLE_STYLE bold", () => {
    expect(mapKeyEvent(key({ key: "b", ctrlKey: true }))).toEqual({
      type: "TOGGLE_STYLE",
      style: "bold",
    });
  });

  it("maps Cmd+I to TOGGLE_STYLE italic", () => {
    expect(mapKeyEvent(key({ key: "i", metaKey: true }))).toEqual({
      type: "TOGGLE_STYLE",
      style: "italic",
    });
  });

  it("maps Cmd+Shift+X to TOGGLE_STYLE strikethrough", () => {
    expect(
      mapKeyEvent(key({ key: "x", metaKey: true, shiftKey: true })),
    ).toEqual({
      type: "TOGGLE_STYLE",
      style: "strikethrough",
    });
  });

  it("maps Ctrl+Shift+X to TOGGLE_STYLE strikethrough", () => {
    expect(
      mapKeyEvent(key({ key: "x", ctrlKey: true, shiftKey: true })),
    ).toEqual({
      type: "TOGGLE_STYLE",
      style: "strikethrough",
    });
  });

  it("maps Cmd+U to TOGGLE_STYLE underline", () => {
    expect(mapKeyEvent(key({ key: "u", metaKey: true }))).toEqual({
      type: "TOGGLE_STYLE",
      style: "underline",
    });
  });

  it("maps Ctrl+\\ to CLEAR_FORMATTING", () => {
    expect(mapKeyEvent(key({ key: "\\", ctrlKey: true }))).toEqual({
      type: "CLEAR_FORMATTING",
    });
  });

  it("maps Cmd+\\ to CLEAR_FORMATTING (macOS)", () => {
    expect(mapKeyEvent(key({ key: "\\", metaKey: true }))).toEqual({
      type: "CLEAR_FORMATTING",
    });
  });

  it("returns null for a bare backslash (no modifier — handled by textarea input)", () => {
    expect(mapKeyEvent(key({ key: "\\" }))).toBeNull();
  });

  // --- Printable chars with shift should still insert ---

  it("returns null for Shift+letter (handled by textarea input)", () => {
    expect(mapKeyEvent(key({ key: "A", shiftKey: true }))).toBeNull();
  });

  // --- Select all ---

  it("maps Cmd+A to SELECT_ALL", () => {
    expect(mapKeyEvent(key({ key: "a", metaKey: true }))).toEqual({
      type: "SELECT_ALL",
    });
  });

  it("maps Ctrl+A to SELECT_ALL", () => {
    expect(mapKeyEvent(key({ key: "a", ctrlKey: true }))).toEqual({
      type: "SELECT_ALL",
    });
  });

  // --- Home / End ---

  it("maps Home to MOVE_LINE_BOUNDARY start", () => {
    expect(mapKeyEvent(key({ key: "Home" }))).toEqual({
      type: "MOVE_LINE_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps End to MOVE_LINE_BOUNDARY end", () => {
    expect(mapKeyEvent(key({ key: "End" }))).toEqual({
      type: "MOVE_LINE_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Shift+Home to EXPAND_LINE_BOUNDARY start", () => {
    expect(mapKeyEvent(key({ key: "Home", shiftKey: true }))).toEqual({
      type: "EXPAND_LINE_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Shift+End to EXPAND_LINE_BOUNDARY end", () => {
    expect(mapKeyEvent(key({ key: "End", shiftKey: true }))).toEqual({
      type: "EXPAND_LINE_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Ctrl+Home to MOVE_DOCUMENT_BOUNDARY start", () => {
    expect(mapKeyEvent(key({ key: "Home", ctrlKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Ctrl+End to MOVE_DOCUMENT_BOUNDARY end", () => {
    expect(mapKeyEvent(key({ key: "End", ctrlKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Shift+Ctrl+Home to EXPAND_DOCUMENT_BOUNDARY start", () => {
    expect(mapKeyEvent(key({ key: "Home", shiftKey: true, ctrlKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Shift+Ctrl+End to EXPAND_DOCUMENT_BOUNDARY end", () => {
    expect(mapKeyEvent(key({ key: "End", shiftKey: true, ctrlKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  // --- Cmd+Home / Cmd+End (Mac convention — should match Ctrl behavior) ---

  it("maps Cmd+Home to MOVE_DOCUMENT_BOUNDARY start (Mac, #174)", () => {
    expect(mapKeyEvent(key({ key: "Home", metaKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Cmd+End to MOVE_DOCUMENT_BOUNDARY end (Mac, #174)", () => {
    expect(mapKeyEvent(key({ key: "End", metaKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Shift+Cmd+Home to EXPAND_DOCUMENT_BOUNDARY start (Mac, #174)", () => {
    expect(mapKeyEvent(key({ key: "Home", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Shift+Cmd+End to EXPAND_DOCUMENT_BOUNDARY end (Mac, #174)", () => {
    expect(mapKeyEvent(key({ key: "End", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  // --- Cmd+Arrow (Mac line/document boundary) ---

  it("maps Cmd+ArrowLeft to MOVE_LINE_BOUNDARY start (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowLeft", metaKey: true }))).toEqual({
      type: "MOVE_LINE_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Cmd+ArrowRight to MOVE_LINE_BOUNDARY end (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowRight", metaKey: true }))).toEqual({
      type: "MOVE_LINE_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Shift+Cmd+ArrowLeft to EXPAND_LINE_BOUNDARY start (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowLeft", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_LINE_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Shift+Cmd+ArrowRight to EXPAND_LINE_BOUNDARY end (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowRight", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_LINE_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Cmd+ArrowUp to MOVE_DOCUMENT_BOUNDARY start (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowUp", metaKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Cmd+ArrowDown to MOVE_DOCUMENT_BOUNDARY end (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowDown", metaKey: true }))).toEqual({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  it("maps Shift+Cmd+ArrowUp to EXPAND_DOCUMENT_BOUNDARY start (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowUp", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  });

  it("maps Shift+Cmd+ArrowDown to EXPAND_DOCUMENT_BOUNDARY end (Mac)", () => {
    expect(mapKeyEvent(key({ key: "ArrowDown", shiftKey: true, metaKey: true }))).toEqual({
      type: "EXPAND_DOCUMENT_BOUNDARY",
      boundary: "end",
    });
  });

  // --- Delete word ---

  it("maps Alt+Backspace to DELETE_WORD backward", () => {
    expect(mapKeyEvent(key({ key: "Backspace", altKey: true }))).toEqual({
      type: "DELETE_WORD",
      direction: "backward",
    });
  });

  it("maps Ctrl+Backspace to DELETE_WORD backward", () => {
    expect(mapKeyEvent(key({ key: "Backspace", ctrlKey: true }))).toEqual({
      type: "DELETE_WORD",
      direction: "backward",
    });
  });

  it("maps Alt+Delete to DELETE_WORD forward", () => {
    expect(mapKeyEvent(key({ key: "Delete", altKey: true }))).toEqual({
      type: "DELETE_WORD",
      direction: "forward",
    });
  });

  it("maps Ctrl+Delete to DELETE_WORD forward", () => {
    expect(mapKeyEvent(key({ key: "Delete", ctrlKey: true }))).toEqual({
      type: "DELETE_WORD",
      direction: "forward",
    });
  });

  // --- Delete to line start ---

  it("maps Cmd+Backspace to DELETE_LINE", () => {
    expect(mapKeyEvent(key({ key: "Backspace", metaKey: true }))).toEqual({
      type: "DELETE_LINE",
    });
  });

  // --- Tab / Shift+Tab list nesting (context-sensitive, #L16) ---

  it("maps Tab in a list-item to LIST_INDENT", () => {
    expect(mapKeyEvent(key({ key: "Tab" }), { inListItem: true })).toEqual({
      type: "LIST_INDENT",
    });
  });

  it("maps Shift+Tab in a list-item to LIST_OUTDENT", () => {
    expect(
      mapKeyEvent(key({ key: "Tab", shiftKey: true }), { inListItem: true }),
    ).toEqual({ type: "LIST_OUTDENT" });
  });

  it("maps Tab outside a list-item to INSERT_TAB", () => {
    expect(mapKeyEvent(key({ key: "Tab" }), { inListItem: false })).toEqual({
      type: "INSERT_TAB",
    });
    expect(mapKeyEvent(key({ key: "Tab" }))).toEqual({ type: "INSERT_TAB" });
  });

  it("leaves Shift+Tab unmapped outside a list-item (no reverse-tab/outdent)", () => {
    expect(mapKeyEvent(key({ key: "Tab", shiftKey: true }), { inListItem: false })).toBeNull();
    expect(mapKeyEvent(key({ key: "Tab", shiftKey: true }))).toBeNull();
  });
});
