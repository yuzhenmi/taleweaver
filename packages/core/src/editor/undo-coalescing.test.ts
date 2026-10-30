/**
 * Reducer-level end-to-end tests for undo typing coalescing (#420).
 *
 * Drives the REAL `reduceEditor` + `History` with an injected `config.now`
 * fake clock (a mutable counter), so the pause window is deterministic. Mirrors
 * the spec's "Test plan" (docs/superpowers/specs/2026-06-01-undo-coalescing-design.md).
 */
import { describe, it, expect } from "vitest";
import { createInitialEditorState, type EditorState } from "./editor-state";
import { reduceEditor } from "./reduce-editor";
import { type EditorConfig } from "./editor-config";
import { config as baseConfig, getTextOf, firstChildId } from "./actions/test-helpers";
import { UNDO_COALESCE_PAUSE_MS } from "../state";
import { createPosition, createSpan } from "../state";

function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** First leaf block's text. */
function textOf(editor: EditorState): string {
  const id = firstChildId(editor.state);
  if (id === null) return "";
  return getTextOf(editor.state, id);
}

describe("undo coalescing through the reducer (#420)", () => {
  it("coalesce by time: 3 INSERT_TEXT within the window → ONE undo restores pre-run state", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(10);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    clock.advance(10);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "c" });
    expect(textOf(editor)).toBe("abc");

    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe("");
    // Nothing left to undo — it was a single coalesced entry.
    expect(editor.history.canUndo()).toBe(false);
  });

  it("pause splits: 2 INSERT_TEXT with clock advanced ≥ window between → two undo entries", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(UNDO_COALESCE_PAUSE_MS); // gap == threshold → split
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    expect(textOf(editor)).toBe("ab");

    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe("a"); // first undo removes "b"
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe(""); // second removes "a"
  });

  it("kind switch: INSERT run then DELETE_BACKWARD run (<window) → undo#1 reverses deletes, undo#2 reverses inserts", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    expect(textOf(editor)).toBe("");

    editor = reduceEditor(editor, { type: "UNDO" }); // reverses the delete run
    expect(textOf(editor)).toBe("ab");
    editor = reduceEditor(editor, { type: "UNDO" }); // reverses the insert run
    expect(textOf(editor)).toBe("");
    expect(editor.history.canUndo()).toBe(false);
  });

  it("command breaks: type / SPLIT_NODE / type (<window) → three undo entries; a 2nd consecutive SPLIT_NODE is its own entry", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });

    let n = 0;
    while (editor.history.canUndo()) {
      editor = reduceEditor(editor, { type: "UNDO" });
      n++;
      if (n > 5) break; // safety
    }
    expect(n).toBe(3);

    // A second consecutive SPLIT_NODE is its own entry (commands never coalesce).
    editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    let m = 0;
    while (editor.history.canUndo()) {
      editor = reduceEditor(editor, { type: "UNDO" });
      m++;
      if (m > 5) break;
    }
    expect(m).toBe(2);
  });

  it("formatting breaks: type / TOGGLE_STYLE bold / type → three entries", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    const id = firstChildId(editor.state);
    if (id === null) throw new Error("no block");
    // Select the typed "a" so TOGGLE_STYLE actually commits an undo entry
    // (bold on a collapsed cursor is a no-op). The SET_SELECTION itself breaks
    // coalescing, but the point under test is that the formatting COMMAND is its
    // own undo unit and does not merge with the later typing.
    clock.advance(5);
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(id, 0), createPosition(id, 1)),
      },
    );
    clock.advance(5);
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });

    let n = 0;
    while (editor.history.canUndo()) {
      editor = reduceEditor(editor, { type: "UNDO" });
      n++;
      if (n > 5) break;
    }
    // Three doc-changing undo entries: insert "a", toggle bold, insert "b".
    expect(n).toBe(3);
  });

  it("selection jump breaks: type / SET_SELECTION / type → two entries", () => {
    // Phase 0b: the geometric MOVE_CURSOR intent now lives in the backend
    // NavIntent resolver, which dispatches a geometry-free SET_SELECTION. Drive
    // that SET_SELECTION directly — it carries the same `selection-break`
    // coalesce key, so it breaks the run the same way MOVE_CURSOR did.
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(5);
    const caretStart = createPosition(editor.selection.focus.blockId, 0);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caretStart, caretStart) },
    );
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    expect(textOf(editor)).toBe("ba");

    let n = 0;
    while (editor.history.canUndo()) {
      editor = reduceEditor(editor, { type: "UNDO" });
      n++;
      if (n > 5) break;
    }
    expect(n).toBe(2);
  });

  it("selection jump breaks via SET_SELECTION too: type / SET_SELECTION / type → two entries", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    const id = firstChildId(editor.state);
    if (id === null) throw new Error("no block");
    clock.advance(5);
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(id, 0), createPosition(id, 0)),
      },
    );
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });

    let n = 0;
    while (editor.history.canUndo()) {
      editor = reduceEditor(editor, { type: "UNDO" });
      n++;
      if (n > 5) break;
    }
    expect(n).toBe(2);
  });

  it("coalesced selection meta: undo restores caret BEFORE the first keystroke, redo restores AFTER the last", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }); // before = offset 0
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }); // after = offset 2

    editor = reduceEditor(editor, { type: "UNDO" });
    expect(editor.selection.focus.offset).toBe(0); // before the first keystroke
    editor = reduceEditor(editor, { type: "REDO" });
    expect(editor.selection.focus.offset).toBe(2); // after the last keystroke
  });

  it("undo then type: UNDO then INSERT_TEXT → the new typing is a fresh entry", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    expect(textOf(editor)).toBe("ab");

    // Undo the whole burst.
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe("");
    // Type within the window — must NOT merge into the (now-undone) burst.
    clock.advance(5);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "c" });
    expect(textOf(editor)).toBe("c");

    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe(""); // removes only "c"
    expect(editor.history.canUndo()).toBe(false);
  });

  it("no-op backstop: a no-op committing action produces no undo entry (only the boundary advances)", () => {
    const clock = makeClock();
    const config: EditorConfig = { ...baseConfig, now: clock.now };
    let editor = createInitialEditorState(config);
    // OUTDENT at margin 0 is a no-op committing action.
    editor = reduceEditor(editor, { type: "OUTDENT" });
    expect(editor.history.canUndo()).toBe(false); // no entry recorded
  });

  it("defaults to Date.now when config.now is absent (still coalesces a fast burst)", () => {
    const config: EditorConfig = { ...baseConfig }; // no `now`
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "y" });
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor)).toBe(""); // fast real-clock burst coalesces → one undo clears both
  });
});
