import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createHistory } from "./history";
import { createEmptyDocument } from "./initial-state";
import { setBlockAttrs } from "./set-block-attrs";
import { getBlock } from "./state";
import { getMetaMap } from "./yjs-doc";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("Yjs UndoManager no-op behavior (empirical baseline)", () => {
  // Step 1.1 finding (2026-05-22): Yjs SKIPS no-op groups under
  // `captureTimeout: 0`. An empty transaction followed by
  // `stopCapturing()` does NOT increment `undoStack.length`. Only
  // transactions that mutated tracked types are recorded.
  //
  // Consequence: action handlers MUST short-circuit BEFORE calling
  // `history.commit` on no-op operations. Otherwise the
  // `undoSelectionStack` would push an entry while `undoStack` stayed
  // flat, breaking the alignment invariant. The write-time assertion
  // in `History.commit` catches this if a handler forgets the guard.
  it("empty transaction does not produce an undoStack entry", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("blocks");
    const um = new Y.UndoManager([map], {
      captureTimeout: 0,
      trackedOrigins: new Set([null]),
    });
    doc.transact(() => {});
    um.stopCapturing();
    expect(um.undoStack.length).toBe(0);

    // Sanity check: a real mutation IS recorded.
    doc.transact(() => {
      map.set("key", new Y.Map());
    });
    um.stopCapturing();
    expect(um.undoStack.length).toBe(1);
  });
});

describe("history (Y.UndoManager wrapper)", () => {
  function firstChild(state: ReturnType<typeof createEmptyDocument>) {
    const root = getBlock(state, state.rootId);
    if (root === null) throw new Error("test fixture: missing root");
    const childId = root.firstChildId;
    if (childId === null) throw new Error("test fixture: missing first child id");
    const child = getBlock(state, childId);
    if (child === null) throw new Error("test fixture: missing first child");
    return child;
  }

  it("starts with no undo/redo available", () => {
    const state = createEmptyDocument();
    const history = createHistory(state);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("commit(opResult, {before, after}) advances state and records the entry", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("undo after a single commit restores the prior Y.Doc state and returns 'before' selection", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(getBlock(undone.state, child.id)?.attrs.bold).toBeUndefined();
    expect(undone.selection).toEqual(before);
  });

  it("redo after undo restores the post-commit state and returns 'after' selection", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });

    const undone = history.undo();
    expect(undone).not.toBeNull();
    expect(history.canRedo()).toBe(true);
    const redone = history.redo();
    expect(redone).not.toBeNull();
    if (redone === null) throw new Error("expected redo to succeed");
    expect(getBlock(redone.state, child.id)?.attrs.bold).toBe(true);
    expect(redone.selection).toEqual(after);
  });

  it("multiple commits, undos and redos in sequence", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    const sel1Before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const sel1After = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(r1, { before: sel1Before, after: sel1After });

    const r2 = setBlockAttrs(state0, child.id, { bold: true, italic: true });
    const sel2Before = sel1After;
    const sel2After = createSpan(createPosition(child.id, 2), createPosition(child.id, 2));
    history.commit(r2, { before: sel2Before, after: sel2After });

    expect(history.undo()).not.toBeNull();
    expect(history.undo()).not.toBeNull();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).not.toBeNull();
    expect(history.redo()).not.toBeNull();
    expect(history.canRedo()).toBe(false);
  });

  it("History does not undo direct writes to the meta map", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });
    expect(history.canUndo()).toBe(true);

    // Directly write to the meta map — intentionally NOT tracked by the
    // UndoManager (see History docstring + getMetaMap docstring).
    getMetaMap(state0.doc).set("foo", "bar");
    expect(getMetaMap(state0.doc).get("foo")).toBe("bar");

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(getBlock(undone.state, child.id)?.attrs.bold).toBeUndefined();
    expect(getMetaMap(state0.doc).get("foo")).toBe("bar");
  });

  it("a new commit after undo clears the redo stack", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    history.commit(r1, { before: sel, after: sel });
    history.undo();
    expect(history.canRedo()).toBe(true);
    const r2 = setBlockAttrs(state0, child.id, { italic: true });
    history.commit(r2, { before: sel, after: sel });
    expect(history.canRedo()).toBe(false);
  });

  it("commit on a no-op opResult would misalign — handlers must short-circuit (assertion fires)", () => {
    // Documents the contract: action handlers must NOT call
    // `history.commit` if `opResult.dirtyIds.size === 0` (Yjs skips
    // no-op groups, so undoStack would not grow). If a handler
    // forgets, the dev-mode write-time alignment assertion catches it.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    // Synthesize a no-op OperationResult by re-using `state0` and
    // passing an empty dirtyIds set.
    const noopResult = { state: state0, dirtyIds: new Set<BlockId>() };
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    expect(() =>
      history.commit(noopResult, { before: sel, after: sel }),
    ).toThrow(/stack alignment broken/);
  });
});
