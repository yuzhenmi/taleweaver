// packages/core/src/editor/caret-page-hint.test.ts
//
// #323 Cycle A: lifecycle of the NON-undoable `caretPageHint` view state on
// `Editor` (mirrors `targetX`). The hint records which page's header/footer
// slot instance the caret is visually on. It is set by `SET_SELECTION`,
// PRESERVED by other handlers (NOT centrally cleared like
// `targetX`), and explicitly cleared by undo/redo + a body `SET_SELECTION`
// (which passes no hint).

import { describe, it, expect } from "vitest";
import { config } from "./actions/test-helpers";
import { createEditor } from "./editor";
import { createSpan, createPosition } from "../state";

describe("#323 Cycle A — caretPageHint lifecycle", () => {
  it("createEditor seeds caretPageHint undefined", () => {
    const editor = createEditor(config);
    expect(editor.caretPageHint).toBeUndefined();
    // P4-C.2 §D: the sibling non-undoable view field `caretAffinity` also
    // defaults to undefined on a fresh state.
    expect(editor.caretAffinity).toBeUndefined();
  });

  it("SET_SELECTION with caretPageHint sets it", () => {
    const editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretPageHint: 1 });
    expect(editor.caretPageHint).toBe(1);
  });

  it("SET_SELECTION without caretPageHint clears it (body click → undefined)", () => {
    const editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    // First set a hint.
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretPageHint: 2 });
    expect(editor.caretPageHint).toBe(2);
    // A body SET_SELECTION (no hint) clears it.
    editor.dispatch({ type: "SET_SELECTION", selection: sel });
    expect(editor.caretPageHint).toBeUndefined();
  });

  it("INSERT_TEXT preserves caretPageHint (per-handler spread, NOT centrally cleared)", () => {
    let editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretPageHint: 1 });
    expect(editor.caretPageHint).toBe(1);
    editor.dispatch({ type: "INSERT_TEXT", text: "x" });
    expect(editor.caretPageHint).toBe(1);
  });

  it("a caret-only Backspace (over a struck character, suggesting mode) preserves caretPageHint", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "abc" });
    editor.setConfig({ ...config, suggestingAuthor: "alice" });
    editor.dispatch({ type: "DELETE_BACKWARD" }); // strikes "c"; the caret goes before it
    const { blockId, offset } = editor.selection.focus;
    const afterStruck = createSpan(createPosition(blockId, offset + 1), createPosition(blockId, offset + 1));
    editor.dispatch({ type: "SET_SELECTION", selection: afterStruck, caretPageHint: 1 });
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(editor.document).toBe(before.document); // nothing written: the caret only moves across the struck "c"
    expect(editor.selection.focus.offset).toBe(offset);
    expect(editor.caretPageHint).toBe(1);
  });

  it("UNDO clears caretPageHint (post-undo page is ambiguous)", () => {
    let editor = createEditor(config);
    // Make a real edit so UNDO has something to revert.
    editor.dispatch({ type: "INSERT_TEXT", text: "hello" });
    // Set a hint, then undo.
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretPageHint: 1 });
    expect(editor.caretPageHint).toBe(1);
    editor.dispatch({ type: "UNDO" });
    expect(editor.caretPageHint).toBeUndefined();
  });

  it("REDO clears caretPageHint", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "hello" });
    editor.dispatch({ type: "UNDO" });
    // Re-set a hint, then redo.
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretPageHint: 1 });
    expect(editor.caretPageHint).toBe(1);
    editor.dispatch({ type: "REDO" });
    expect(editor.caretPageHint).toBeUndefined();
  });
});

describe("P4-C.2.2b — caretAffinity lifecycle (central-reset model)", () => {
  // UNLIKE caretPageHint (preserved by the per-handler spread), caretAffinity is
  // CENTRALLY RESET in reduceEditor for any action that does NOT explicitly
  // manage it (the `actionManagesCaretAffinity` predicate — today only
  // SET_SELECTION). So it persists ONLY across the actions that set it and never
  // goes stale after an edit.

  it("SET_SELECTION with caretAffinity:'before' sets editor.caretAffinity", () => {
    const editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretAffinity: "before" });
    expect(editor.caretAffinity).toBe("before");
  });

  it("a programmatic SET_SELECTION WITHOUT caretAffinity clears it to undefined", () => {
    let editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretAffinity: "before" });
    expect(editor.caretAffinity).toBe("before");
    // A SET_SELECTION with no affinity explicitly clears it (no boundary context).
    editor.dispatch({ type: "SET_SELECTION", selection: sel });
    expect(editor.caretAffinity).toBeUndefined();
  });

  it("INSERT_TEXT (a non-managing action) RESETS caretAffinity — the central reset", () => {
    let editor = createEditor(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor.dispatch({ type: "SET_SELECTION", selection: sel, caretAffinity: "before" });
    expect(editor.caretAffinity).toBe("before");
    // An edit does NOT manage affinity → the central reset clears it (whereas
    // caretPageHint would survive the same INSERT_TEXT).
    editor.dispatch({ type: "INSERT_TEXT", text: "x" });
    expect(editor.caretAffinity).toBeUndefined();
  });
});
