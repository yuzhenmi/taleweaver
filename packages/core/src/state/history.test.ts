import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createHistory } from "./history";
import type { SelectionEntry } from "./history";
import { createEmptyDocument } from "./initial-state";
import { setBlockAttrs } from "./set-block-attrs";
import { applyOperation, getBlock } from "./state";
import { getMetaMap, getTemplateContentsMap, getYBlock } from "./yjs-doc";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";
import { STATE_INTERNAL } from "./state-internal";
import { buildState, buildBlock } from "../test-utils/state-builders";

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

  it("commit refuses a no-op (empty dirtyIds) BEFORE mutating; stacks stay aligned (S-B2)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));

    // Hand-built no-op result (empty dirtyIds), independent of S-B1's no-op path.
    const noop = { state: state0, dirtyIds: new Set<BlockId>() };
    expect(() => history.commit(noop, { before, after })).toThrow(/no-op/);
    expect(history.canUndo()).toBe(false);

    // The rejected no-op must NOT have partially mutated (pushed a selection
    // entry / advanced currentState): a subsequent REAL commit + undo round-trips
    // cleanly. On the pre-fix code the no-op pushed an unmatched selection entry
    // before throwing, so this real commit would trip the alignment assertion.
    const real = setBlockAttrs(state0, child.id, { bold: true });
    history.commit(real, { before, after });
    expect(history.canUndo()).toBe(true);
    const undone = history.undo();
    expect(undone?.selection).toEqual(before);
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

  it("undo returns dirtyIds matching the blocks reversed by the undo (S-A3)", () => {
    // Before S-A3 the editor's render pipeline had no dirtyIds to use
    // on undo, so it fell back to a full re-render. Y.UndoManager.undo
    // mutates the Y.Doc inside its own transaction, which fires
    // afterTransaction with a non-trivial change set; capturing it the
    // same way runTransaction does lets undo participate in incremental
    // render.
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
    expect(undone.dirtyIds.has(child.id)).toBe(true);
  });

  it("redo returns dirtyIds matching the blocks re-applied (S-A3)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });

    history.undo();
    const redone = history.redo();
    expect(redone).not.toBeNull();
    if (redone === null) throw new Error("expected redo to succeed");
    expect(redone.dirtyIds.has(child.id)).toBe(true);
  });

  it("undo after an unchanged-block read returns dirtyIds covering only the reversed block — warm cache for siblings is preserved", () => {
    // S-A2 + S-A3 together let undo/redo reuse the warm cache for
    // unchanged blocks. Specifically, the new State produced by undo
    // overlays the prior state's cache with `dirtyIds` invalidated;
    // sibling reads still hit the warm entry by reference.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    // Warm a sibling read on the pre-commit state by reading the root.
    const rootBefore = getBlock(state0, state0.rootId);
    expect(rootBefore).not.toBeNull();
    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    history.commit(opResult, { before: sel, after: sel });

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo");
    // The undo's dirty set covers child.id only (root is unchanged).
    expect(undone.dirtyIds.has(child.id)).toBe(true);
    expect(undone.dirtyIds.has(state0.rootId)).toBe(false);
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

  it("four-step walk-through asserts selection algebra (T4)", () => {
    // Plan §T4 walk-through (with setBlockAttrs standing in for typing
    // — same algebra, simpler setup):
    //   commit({before: pos0, after: pos1})  ← "type 'abc'"
    //   undo  → returns {selection: pos0}, undoStack=[], redoStack=[{pos0,pos1}]
    //   redo  → returns {selection: pos1}, undoStack=[{pos0,pos1}], redoStack=[]
    //   commit({before: pos1, after: pos2})  ← "type 'def'"
    //   undo  → returns {selection: pos1}, undoStack=[{pos0,pos1}], redoStack=[{pos1,pos2}]
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const pos0 = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const pos1 = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    const pos2 = createSpan(createPosition(child.id, 2), createPosition(child.id, 2));

    // Step 1: first commit
    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    history.commit(r1, { before: pos0, after: pos1 });

    // Step 2: undo → returns BEFORE side
    const u1 = history.undo();
    expect(u1).not.toBeNull();
    if (u1 === null) throw new Error("expected undo to succeed");
    expect(u1.selection).toEqual(pos0);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    // Step 3: redo → returns AFTER side (catches the original-draft bug
    // where redo would have returned the same `before` value)
    const r1Redone = history.redo();
    expect(r1Redone).not.toBeNull();
    if (r1Redone === null) throw new Error("expected redo to succeed");
    expect(r1Redone.selection).toEqual(pos1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    // Step 4: second commit
    const r2 = setBlockAttrs(state0, child.id, { bold: true, italic: true });
    history.commit(r2, { before: pos1, after: pos2 });

    // Step 5: undo → returns r2's BEFORE side
    const u2 = history.undo();
    expect(u2).not.toBeNull();
    if (u2 === null) throw new Error("expected undo to succeed");
    expect(u2.selection).toEqual(pos1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(true);
  });

  it("three undos then two redos preserve selection algebra (T4)", () => {
    // Build three distinct commits with non-aliased before/after pairs,
    // undo them all, then redo twice. Each step asserts the exact
    // selection returned.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const p0 = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const p1 = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    const p2 = createSpan(createPosition(child.id, 2), createPosition(child.id, 2));
    const p3 = createSpan(createPosition(child.id, 3), createPosition(child.id, 3));

    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    history.commit(r1, { before: p0, after: p1 });
    const r2 = setBlockAttrs(state0, child.id, { bold: true, italic: true });
    history.commit(r2, { before: p1, after: p2 });
    const r3 = setBlockAttrs(state0, child.id, {
      bold: true,
      italic: true,
      underline: true,
    });
    history.commit(r3, { before: p2, after: p3 });

    // Three consecutive undos — each returns its commit's BEFORE side
    // in reverse order: p2, p1, p0.
    const u3 = history.undo();
    expect(u3).not.toBeNull();
    if (u3 === null) throw new Error("expected undo to succeed");
    expect(u3.selection).toEqual(p2);

    const u2 = history.undo();
    expect(u2).not.toBeNull();
    if (u2 === null) throw new Error("expected undo to succeed");
    expect(u2.selection).toEqual(p1);

    const u1 = history.undo();
    expect(u1).not.toBeNull();
    if (u1 === null) throw new Error("expected undo to succeed");
    expect(u1.selection).toEqual(p0);

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    // Two redos — each returns its commit's AFTER side in oldest-first
    // order: p1, p2.
    const redo1 = history.redo();
    expect(redo1).not.toBeNull();
    if (redo1 === null) throw new Error("expected redo to succeed");
    expect(redo1.selection).toEqual(p1);

    const redo2 = history.redo();
    expect(redo2).not.toBeNull();
    if (redo2 === null) throw new Error("expected redo to succeed");
    expect(redo2.selection).toEqual(p2);

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(true);
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
    getMetaMap(state0[STATE_INTERNAL].doc).set("foo", "bar");
    expect(getMetaMap(state0[STATE_INTERNAL].doc).get("foo")).toBe("bar");

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(getBlock(undone.state, child.id)?.attrs.bold).toBeUndefined();
    expect(getMetaMap(state0[STATE_INTERNAL].doc).get("foo")).toBe("bar");
  });

  it("undo/redo reverts and re-applies an edit to a template-content body (C.2a-T2)", () => {
    // C.2a-T2: template bodies (header/footer bodies) live in their own
    // top-level templateContents Y.Map. Edits to them must be undoable, so
    // the History UndoManager must track that map as a third scope alongside
    // blocks + embedContents. Asserted at the raw Y.Doc level (the
    // getTemplateContent accessor lands in T4) to keep this test
    // self-contained.
    const bodyId = "tmplBody";
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: null, lastChildId: null }),
      ],
      templateContents: [
        buildBlock({ id: bodyId, type: "paragraph", parentId: null }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;

    // Pre-edit value at the raw Y.Doc level.
    expect(getTemplateContentsMap(doc).get(bodyId)?.get("type")).toBe("paragraph");

    const history = createHistory(state);
    // Edit the template body's `type` field inside a tracked transaction.
    const opResult = applyOperation(state, () => {
      getYBlock(doc, bodyId as BlockId, "test", "templateContent").set("type", "heading");
    });
    expect(getTemplateContentsMap(doc).get(bodyId)?.get("type")).toBe("heading");

    const sel = createSpan(createPosition(bodyId as BlockId, 0), createPosition(bodyId as BlockId, 0));
    history.commit(opResult, { before: sel, after: sel });
    expect(history.canUndo()).toBe(true);

    // Undo must revert the template-body field to its pre-edit value.
    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(getTemplateContentsMap(doc).get(bodyId)?.get("type")).toBe("paragraph");
    expect(undone.dirtyIds.has(bodyId as BlockId)).toBe(true);

    // Redo re-applies the edit.
    const redone = history.redo();
    expect(redone).not.toBeNull();
    if (redone === null) throw new Error("expected redo to succeed");
    expect(getTemplateContentsMap(doc).get(bodyId)?.get("type")).toBe("heading");
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

  it("undo() read-time alignment assertion fires on manual desync (T2)", () => {
    // T2 read-time defense-in-depth: if the selection stack and the
    // Y.UndoManager undo stack ever desync (e.g., because an op fired
    // without a corresponding history.commit), the assertion at the top
    // of undo() catches it before any state read or mutation.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    // Manually push an entry onto the selection stack without firing
    // a Y.Doc transaction — synthesizes the desync condition.
    (
      history as unknown as { undoSelectionStack: SelectionEntry[] }
    ).undoSelectionStack.push({ before: sel, after: sel });

    expect(() => history.undo()).toThrow(/stack misalignment/);
  });

  it("redo() read-time alignment assertion fires on manual desync (T2)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    (
      history as unknown as { redoSelectionStack: SelectionEntry[] }
    ).redoSelectionStack.push({ before: sel, after: sel });

    expect(() => history.redo()).toThrow(/stack misalignment/);
  });

  it("undo() error-recovery: if undoManager.undo throws, stacks are not mutated (T33)", () => {
    // Monkey-patch undoManager.undo to throw. Cleanup happens in two
    // layers: captureDirtyIds (which wraps undoManager.undo) detaches
    // its afterTransaction listener in its own `finally`; the outer
    // History.undo() body's try/catch (per plan §T33 step 33.2) catches
    // the rethrown error and surfaces a wrapped message. On any throw
    // the selection stacks MUST remain untouched so a subsequent retry
    // has correct alignment.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });

    type StacksView = {
      undoSelectionStack: SelectionEntry[];
      redoSelectionStack: SelectionEntry[];
      undoManager: { undo: () => void };
    };
    const internals = history as unknown as StacksView;
    const undoStackBefore = internals.undoSelectionStack.slice();
    const redoStackBefore = internals.redoSelectionStack.slice();
    internals.undoManager.undo = () => {
      throw new Error("simulated Yjs failure");
    };

    expect(() => history.undo()).toThrow(/failed mid-operation/);
    // Stacks are NOT mutated despite the throw.
    expect(internals.undoSelectionStack).toEqual(undoStackBefore);
    expect(internals.redoSelectionStack).toEqual(redoStackBefore);
  });

  it("redo() error-recovery: if undoManager.redo throws, stacks are not mutated (T33)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });
    // Move the entry onto the redo stack so the redo() path is exercised.
    history.undo();

    type StacksView = {
      undoSelectionStack: SelectionEntry[];
      redoSelectionStack: SelectionEntry[];
      undoManager: { redo: () => void };
    };
    const internals = history as unknown as StacksView;
    const undoStackBefore = internals.undoSelectionStack.slice();
    const redoStackBefore = internals.redoSelectionStack.slice();
    internals.undoManager.redo = () => {
      throw new Error("simulated Yjs failure");
    };

    expect(() => history.redo()).toThrow(/failed mid-operation/);
    expect(internals.undoSelectionStack).toEqual(undoStackBefore);
    expect(internals.redoSelectionStack).toEqual(redoStackBefore);
  });

  it("commit on a no-op opResult is rejected by the pre-mutation guard (handlers must short-circuit)", () => {
    // Documents the contract: action handlers must NOT call
    // `history.commit` if `opResult.dirtyIds.size === 0` (Yjs skips
    // no-op groups, so undoStack would not grow). The dev-mode
    // pre-condition guard (S-B2) catches this BEFORE any mutation, so the
    // wrapper is never left half-updated. (A post-mutation stack-alignment
    // assertion remains as a belt-and-suspenders for other desync causes.)
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    // Synthesize a no-op OperationResult by re-using `state0` and
    // passing an empty dirtyIds set.
    const noopResult = { state: state0, dirtyIds: new Set<BlockId>() };
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    expect(() =>
      history.commit(noopResult, { before: sel, after: sel }),
    ).toThrow(/no-op operation/);
  });
});

describe("history undo-depth cap (#234)", () => {
  function firstChildOf(state: ReturnType<typeof createEmptyDocument>): BlockId {
    const root = getBlock(state, state.rootId);
    if (root === null || root.firstChildId === null) {
      throw new Error("test fixture: missing first child");
    }
    return root.firstChildId;
  }

  /** Commit a REPLACE of the child's attrs to `{ v }`; returns the new state. */
  function commitV(
    history: ReturnType<typeof createHistory>,
    state: ReturnType<typeof createEmptyDocument>,
    childId: BlockId,
    v: number,
  ): ReturnType<typeof createEmptyDocument> {
    const r = setBlockAttrs(state, childId, { v });
    const sel = createSpan(createPosition(childId, 0), createPosition(childId, 0));
    history.commit(r, { before: sel, after: sel });
    return r.state;
  }

  it("caps the undo stack at maxDepth, dropping the OLDEST entries", () => {
    let state = createEmptyDocument();
    const childId = firstChildOf(state);
    const history = createHistory(state, 2);

    // Four distinct mutations; cap = 2 retains only the last two groups.
    state = commitV(history, state, childId, 1);
    state = commitV(history, state, childId, 2);
    state = commitV(history, state, childId, 3);
    state = commitV(history, state, childId, 4);
    expect(getBlock(state, childId)?.attrs).toEqual({ v: 4 });

    // Undo reverts v:4 → v:3.
    const u1 = history.undo();
    if (u1 === null) throw new Error("expected undo 1");
    expect(getBlock(u1.state, childId)?.attrs).toEqual({ v: 3 });

    // Undo reverts v:3 → v:2.
    const u2 = history.undo();
    if (u2 === null) throw new Error("expected undo 2");
    expect(getBlock(u2.state, childId)?.attrs).toEqual({ v: 2 });

    // Commits 1 and 2 (initial→v:1, v:1→v:2) were trimmed; the retained
    // window starts at the v:2→v:3 group, so v:2 is its floor — no further back.
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("cap=1 retains only the most recent group", () => {
    let state = createEmptyDocument();
    const childId = firstChildOf(state);
    const history = createHistory(state, 1);

    state = commitV(history, state, childId, 1);
    state = commitV(history, state, childId, 2);
    state = commitV(history, state, childId, 3);

    // Only the last group (v:2→v:3) survives; one undo lands at v:2, then stop.
    const u1 = history.undo();
    if (u1 === null) throw new Error("expected undo 1");
    expect(getBlock(u1.state, childId)?.attrs).toEqual({ v: 2 });
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("does not trim when commits stay under the cap (full history undoable)", () => {
    let state = createEmptyDocument();
    const childId = firstChildOf(state);
    const history = createHistory(state, 5);

    state = commitV(history, state, childId, 1);
    state = commitV(history, state, childId, 2);
    state = commitV(history, state, childId, 3);

    history.undo(); // v3 → v2
    history.undo(); // v2 → v1
    const u3 = history.undo(); // v1 → initial {}
    if (u3 === null) throw new Error("expected undo 3");
    expect(getBlock(u3.state, childId)?.attrs).toEqual({});
    expect(history.canUndo()).toBe(false);
  });

  it("redo works within the retained post-cap window", () => {
    let state = createEmptyDocument();
    const childId = firstChildOf(state);
    const history = createHistory(state, 2);

    state = commitV(history, state, childId, 1);
    state = commitV(history, state, childId, 2);
    state = commitV(history, state, childId, 3);
    state = commitV(history, state, childId, 4);

    history.undo(); // v4 → v3
    history.undo(); // v3 → v2 (canUndo now false)

    const r1 = history.redo(); // v2 → v3
    if (r1 === null) throw new Error("expected redo 1");
    expect(getBlock(r1.state, childId)?.attrs).toEqual({ v: 3 });

    const r2 = history.redo(); // v3 → v4
    if (r2 === null) throw new Error("expected redo 2");
    expect(getBlock(r2.state, childId)?.attrs).toEqual({ v: 4 });
  });

  it("rejects maxDepth < 1", () => {
    const state = createEmptyDocument();
    expect(() => createHistory(state, 0)).toThrow(/maxDepth must be >= 1/);
  });
});
