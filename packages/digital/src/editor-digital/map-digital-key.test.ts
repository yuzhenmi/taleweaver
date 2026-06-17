import { describe, it, expect } from "vitest";
import { mapDigitalKey, type KeyContext } from "./map-digital-key";

const PC: KeyContext = { mac: false };
const MAC: KeyContext = { mac: true };

interface KeyInit {
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}

function key(name: string, init: KeyInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: name,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
}

describe("mapDigitalKey — non-nav chords (2d / F4)", () => {
  it("returns null for nav keys — the browser owns caret movement", () => {
    for (const nav of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]) {
      expect(mapDigitalKey(key(nav), PC)).toBeNull();
      expect(mapDigitalKey(key(nav, { ctrlKey: true }), PC)).toBeNull();
      expect(mapDigitalKey(key(nav, { metaKey: true }), MAC)).toBeNull();
      // Shift+nav (extend selection) is also the browser's job — must stay null.
      expect(mapDigitalKey(key(nav, { shiftKey: true }), PC)).toBeNull();
    }
  });

  it("returns null for Backspace/Delete/Enter — beforeinput owns them", () => {
    expect(mapDigitalKey(key("Backspace"), PC)).toBeNull();
    expect(mapDigitalKey(key("Delete"), PC)).toBeNull();
    expect(mapDigitalKey(key("Enter"), PC)).toBeNull();
  });

  it("returns null for a plain printable key", () => {
    expect(mapDigitalKey(key("a"), PC)).toBeNull();
    expect(mapDigitalKey(key("A"), PC)).toBeNull();
    expect(mapDigitalKey(key("b"), PC)).toBeNull();
    expect(mapDigitalKey(key("1"), PC)).toBeNull();
  });

  it("Escape → ESCAPE (no modifier needed)", () => {
    expect(mapDigitalKey(key("Escape"), PC)).toEqual({ type: "ESCAPE" });
    expect(mapDigitalKey(key("Escape"), MAC)).toEqual({ type: "ESCAPE" });
  });

  it("Tab outside a list → INSERT_TAB (Google-Docs body-text default)", () => {
    expect(mapDigitalKey(key("Tab"), PC)).toEqual({ type: "INSERT_TAB" });
    expect(mapDigitalKey(key("Tab"), MAC)).toEqual({ type: "INSERT_TAB" });
  });

  it("Shift+Tab outside a list → null (Google Docs has no body-text reverse-tab)", () => {
    expect(mapDigitalKey(key("Tab", { shiftKey: true }), PC)).toBeNull();
    expect(mapDigitalKey(key("Tab", { shiftKey: true }), MAC)).toBeNull();
  });

  it("Tab in a list-item → LIST_INDENT (nest); Shift+Tab → LIST_OUTDENT (un-nest)", () => {
    const inList: KeyContext = { mac: false, inListItem: true };
    expect(mapDigitalKey(key("Tab"), inList)).toEqual({ type: "LIST_INDENT" });
    expect(mapDigitalKey(key("Tab", { shiftKey: true }), inList)).toEqual({ type: "LIST_OUTDENT" });
  });

  it("Cmd+B on mac and Ctrl+B on PC → TOGGLE_STYLE bold", () => {
    expect(mapDigitalKey(key("b", { metaKey: true }), MAC)).toEqual({
      type: "TOGGLE_STYLE",
      style: "bold",
    });
    expect(mapDigitalKey(key("b", { ctrlKey: true }), PC)).toEqual({
      type: "TOGGLE_STYLE",
      style: "bold",
    });
  });

  it("Cmd+B on PC (wrong modifier for platform) → null", () => {
    expect(mapDigitalKey(key("b", { metaKey: true }), PC)).toBeNull();
  });

  it("Ctrl+B on mac (wrong modifier for platform) → null", () => {
    expect(mapDigitalKey(key("b", { ctrlKey: true }), MAC)).toBeNull();
  });

  it("primary-chord I → italic, U → underline", () => {
    expect(mapDigitalKey(key("i", { ctrlKey: true }), PC)).toEqual({
      type: "TOGGLE_STYLE",
      style: "italic",
    });
    expect(mapDigitalKey(key("u", { ctrlKey: true }), PC)).toEqual({
      type: "TOGGLE_STYLE",
      style: "underline",
    });
  });

  it("Ctrl+Shift+X → strikethrough; Ctrl+X (no shift) → null (cut owned by beforeinput)", () => {
    expect(mapDigitalKey(key("x", { ctrlKey: true, shiftKey: true }), PC)).toEqual({
      type: "TOGGLE_STYLE",
      style: "strikethrough",
    });
    expect(mapDigitalKey(key("x", { ctrlKey: true }), PC)).toBeNull();
  });

  it("Ctrl+\\ → CLEAR_FORMATTING", () => {
    expect(mapDigitalKey(key("\\", { ctrlKey: true }), PC)).toEqual({ type: "CLEAR_FORMATTING" });
  });

  it("Ctrl+A → SELECT_ALL", () => {
    expect(mapDigitalKey(key("a", { ctrlKey: true }), PC)).toEqual({ type: "SELECT_ALL" });
  });

  it("Ctrl+Z → UNDO; Ctrl+Shift+Z → REDO; Ctrl+Y → REDO", () => {
    expect(mapDigitalKey(key("z", { ctrlKey: true }), PC)).toEqual({ type: "UNDO" });
    expect(mapDigitalKey(key("z", { ctrlKey: true, shiftKey: true }), PC)).toEqual({
      type: "REDO",
    });
    expect(mapDigitalKey(key("y", { ctrlKey: true }), PC)).toEqual({ type: "REDO" });
  });

  it("chord casing is normalized (Cmd+Shift+Z with uppercase key Z → REDO)", () => {
    expect(mapDigitalKey(key("Z", { metaKey: true, shiftKey: true }), MAC)).toEqual({
      type: "REDO",
    });
  });

  it("an unmapped primary-chord key → null (browser/native default)", () => {
    expect(mapDigitalKey(key("k", { ctrlKey: true }), PC)).toBeNull();
  });
});
