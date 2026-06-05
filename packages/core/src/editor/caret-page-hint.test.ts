// packages/core/src/editor/caret-page-hint.test.ts
//
// #323 Cycle A: lifecycle of the NON-undoable `caretPageHint` view state on
// `EditorState` (mirrors `targetX`). The hint records which page's header/footer
// slot instance the caret is visually on. It is set by `SET_SELECTION`,
// PRESERVED by other handlers' `{...editor}` spread (NOT centrally cleared like
// `targetX`), and explicitly cleared by undo/redo + a body `SET_SELECTION`
// (which passes no hint).

import { describe, it, expect } from "vitest";
import { config, reduceEditor } from "./actions/test-helpers";
import { createInitialEditorState } from "./editor-state";
import { createSpan } from "../state";

describe("#323 Cycle A — caretPageHint lifecycle", () => {
  it("createInitialEditorState seeds caretPageHint undefined", () => {
    const editor = createInitialEditorState(config);
    expect(editor.caretPageHint).toBeUndefined();
    // P4-C.2 §D: the sibling non-undoable view field `caretAffinity` also
    // defaults to undefined on a fresh state.
    expect(editor.caretAffinity).toBeUndefined();
  });

  it("SET_SELECTION with caretPageHint sets it", () => {
    const editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    const next = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretPageHint: 1 },
      config,
    );
    expect(next.caretPageHint).toBe(1);
  });

  it("SET_SELECTION without caretPageHint clears it (body click → undefined)", () => {
    const editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    // First set a hint.
    const withHint = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretPageHint: 2 },
      config,
    );
    expect(withHint.caretPageHint).toBe(2);
    // A body SET_SELECTION (no hint) clears it.
    const cleared = reduceEditor(
      withHint,
      { type: "SET_SELECTION", selection: sel },
      config,
    );
    expect(cleared.caretPageHint).toBeUndefined();
  });

  it("INSERT_TEXT preserves caretPageHint (per-handler spread, NOT centrally cleared)", () => {
    let editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretPageHint: 1 },
      config,
    );
    expect(editor.caretPageHint).toBe(1);
    const typed = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(typed.caretPageHint).toBe(1);
  });

  it("UNDO clears caretPageHint (post-undo page is ambiguous)", () => {
    let editor = createInitialEditorState(config);
    // Make a real edit so UNDO has something to revert.
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "hello" }, config);
    // Set a hint, then undo.
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretPageHint: 1 },
      config,
    );
    expect(editor.caretPageHint).toBe(1);
    const undone = reduceEditor(editor, { type: "UNDO" }, config);
    expect(undone.caretPageHint).toBeUndefined();
  });

  it("REDO clears caretPageHint", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "hello" }, config);
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    // Re-set a hint, then redo.
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretPageHint: 1 },
      config,
    );
    expect(editor.caretPageHint).toBe(1);
    const redone = reduceEditor(editor, { type: "REDO" }, config);
    expect(redone.caretPageHint).toBeUndefined();
  });
});

describe("P4-C.2.2b — caretAffinity lifecycle (central-reset model)", () => {
  // UNLIKE caretPageHint (preserved by the per-handler spread), caretAffinity is
  // CENTRALLY RESET in reduceEditor for any action that does NOT explicitly
  // manage it (the `actionManagesCaretAffinity` predicate — today only
  // SET_SELECTION). So it persists ONLY across the actions that set it and never
  // goes stale after an edit.

  it("SET_SELECTION with caretAffinity:'before' sets editor.caretAffinity", () => {
    const editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    const next = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretAffinity: "before" },
      config,
    );
    expect(next.caretAffinity).toBe("before");
  });

  it("a programmatic SET_SELECTION WITHOUT caretAffinity clears it to undefined", () => {
    let editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretAffinity: "before" },
      config,
    );
    expect(editor.caretAffinity).toBe("before");
    // A SET_SELECTION with no affinity explicitly clears it (no boundary context).
    const cleared = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel },
      config,
    );
    expect(cleared.caretAffinity).toBeUndefined();
  });

  it("INSERT_TEXT (a non-managing action) RESETS caretAffinity — the central reset", () => {
    let editor = createInitialEditorState(config);
    const first = editor.selection.focus;
    const sel = createSpan(first, first);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: sel, caretAffinity: "before" },
      config,
    );
    expect(editor.caretAffinity).toBe("before");
    // An edit does NOT manage affinity → the central reset clears it (whereas
    // caretPageHint would survive the same INSERT_TEXT).
    const typed = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(typed.caretAffinity).toBeUndefined();
  });
});
