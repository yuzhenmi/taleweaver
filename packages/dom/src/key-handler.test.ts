import { describe, it, expect } from "vitest";
import { mapKeyEvent, type EditorAction } from "./key-handler";

function key(overrides: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: overrides.key,
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
    expect(mapKeyEvent(key({ key: "Tab" }))).toBeNull();
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

  it("maps Cmd+U to TOGGLE_STYLE underline", () => {
    expect(mapKeyEvent(key({ key: "u", metaKey: true }))).toEqual({
      type: "TOGGLE_STYLE",
      style: "underline",
    });
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
});
