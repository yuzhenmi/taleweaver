/**
 * #419 — LOCKS a crash class: "undoing an Enter (SPLIT_NODE) in the middle of a
 * line must restore a VALID, in-context, resolvable selection that does not
 * crash a downstream selection consumer."
 *
 * #419 was reported as an intermittent crash when undoing a mid-line split. A
 * thorough investigation found NO live repro through the real editor + History
 * across many scenarios: the crash was already fixed by #420 (undo coalescing —
 * a SPLIT is its own undo unit, so an undo restores exactly the pre-split
 * selection rather than a coalesced/stale one) and #424 (the cross-context
 * SET_SELECTION guard, the same crash class as #423 — a stale/cross-context
 * selection that crashed the toolbar's `iterateSpan` / `getActiveFormatting` on
 * the next render).
 *
 * This is a GREEN regression guard (the property holds today): it pins the
 * post-undo selection to be resolvable and in-context, and exercises the actual
 * throwing primitive (`getActiveFormatting`, which fans out to `iterateSpan`
 * for ranges) so a future regression that re-introduces a stale/cross-context
 * post-undo selection fails HERE instead of crashing in the browser toolbar.
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState } from "./actions/test-helpers";
import type { EditorState } from "./editor-state";
import { selectionContextOf, getActiveFormatting, resolveBlock } from "../state";
import type { BlockId } from "../state";

/**
 * Build an editor with a footnote, returning a footnote-body block id. Mirrors
 * the `withFootnote` fixture in set-selection-cross-context.test.ts:
 * INSERT_FOOTNOTE drops the caret into the footnote body (a distinct selection
 * context from the main host paragraph).
 */
function withFootnote(): { editor: EditorState; bodyId: BlockId } {
  const initial = createInitialEditorState(config);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
  const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
  const bodyId = withFn.selection.focus.blockId;
  return { editor: withFn, bodyId };
}

/**
 * Assert a selection resolves, is in a single non-null context, and does not
 * crash the toolbar's read-side consumer (the #419/#423 crash shape — a
 * stale/cross-context selection throws here via `iterateSpan`).
 */
function expectSelectionValidAndInContext(editor: EditorState): void {
  const anchorCtx = selectionContextOf(editor.state, editor.selection.anchor.blockId);
  const focusCtx = selectionContextOf(editor.state, editor.selection.focus.blockId);
  expect(anchorCtx).not.toBeNull();
  expect(focusCtx).not.toBeNull();
  expect(anchorCtx).toBe(focusCtx);
  // The block the restored selection points at still exists.
  expect(resolveBlock(editor.state, editor.selection.focus.blockId)).not.toBeNull();
  expect(resolveBlock(editor.state, editor.selection.anchor.blockId)).not.toBeNull();
  // The actual throwing primitive: a stale/cross-context span would crash here.
  expect(() => getActiveFormatting(editor.state, editor.selection)).not.toThrow();
}

describe("#419 — undo of a mid-line split restores a valid in-context selection", () => {
  it("main-tree mid-line split → undo → selection valid + consumer doesn't throw", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello world" }, config);
    const blockId = typed.selection.focus.blockId;

    // Place a collapsed caret mid-line, between "hello" and " world".
    const atMid = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId, offset: 5 },
          focus: { blockId, offset: 5 },
        },
      },
      config,
    );

    const split = reduceEditor(atMid, { type: "SPLIT_NODE" }, config);
    // Sanity: the split actually produced a second block.
    expect(split.selection.focus.blockId).not.toBe(blockId);

    const undone = reduceEditor(split, { type: "UNDO" }, config);
    expectSelectionValidAndInContext(undone);
  });

  it("footnote-body mid-line split → undo → selection valid + in the footnote context", () => {
    const { editor } = withFootnote();
    const typed = reduceEditor(editor, { type: "INSERT_TEXT", text: "note body" }, config);
    const bodyBlockId = typed.selection.focus.blockId;
    const bodyCtx = selectionContextOf(typed.state, bodyBlockId);
    expect(bodyCtx).not.toBeNull();

    // Caret mid-body, between "note" and " body".
    const atMid = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: bodyBlockId, offset: 4 },
          focus: { blockId: bodyBlockId, offset: 4 },
        },
      },
      config,
    );

    const split = reduceEditor(atMid, { type: "SPLIT_NODE" }, config);
    const undone = reduceEditor(split, { type: "UNDO" }, config);

    expectSelectionValidAndInContext(undone);
    // The restored selection stays in the SAME footnote-body context.
    expect(selectionContextOf(undone.state, undone.selection.focus.blockId)).toBe(bodyCtx);
  });

  it("split → undo → redo → undo keeps the selection valid + consumer safe at each step", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello world" }, config);
    const blockId = typed.selection.focus.blockId;
    const atMid = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId, offset: 5 },
          focus: { blockId, offset: 5 },
        },
      },
      config,
    );

    const split = reduceEditor(atMid, { type: "SPLIT_NODE" }, config);
    const undo1 = reduceEditor(split, { type: "UNDO" }, config);
    expectSelectionValidAndInContext(undo1);

    const redo = reduceEditor(undo1, { type: "REDO" }, config);
    expectSelectionValidAndInContext(redo);

    const undo2 = reduceEditor(redo, { type: "UNDO" }, config);
    expectSelectionValidAndInContext(undo2);
  });
});
