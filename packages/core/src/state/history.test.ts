import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { createHistory, UNDO_COALESCE_PAUSE_MS, type History } from "./history";
import { createEmptyDocument } from "./initial-state";
import { setBlockAttrs, setBlockAttrsInTx } from "./ops/set-block-attrs";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { applyOperation, getBlock } from "./state";
import { getMetaMap, getTemplateContentsMap, getYBlock, runWithTransactionOrigin } from "./yjs-doc";
import { getListDef, writeListDefInTx, type ListDef } from "./list-defs";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText } from "./extract-text";
import type { BlockId } from "./block-id";
import { STATE_INTERNAL } from "./state-internal";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { SUGGESTION_RESOLVE_ORIGIN } from "./suggestions";

describe("Yjs UndoManager no-op behavior (empirical baseline)", () => {
  // Step 1.1 finding (2026-05-22): Yjs SKIPS no-op groups under
  // `captureTimeout: 0`. An empty transaction followed by
  // `stopCapturing()` does NOT increment `undoStack.length`. Only
  // transactions that mutated tracked types are recorded.
  //
  // Consequence: `History.commit` silently drops a no-op opResult — there
  // is no StackItem to attach the SelectionEntry to (the entry lives on
  // `StackItem.meta`, not in a parallel array), so commit returns early
  // before any mutation. Handlers conventionally short-circuit FIRST via
  // the T7 identity contract (`result.state === editor.state`), but commit
  // is itself no-op-safe.
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

  it("commit silently drops a no-op (empty dirtyIds) BEFORE mutating; stacks stay aligned (S-B2)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));

    // Hand-built no-op result (empty dirtyIds), independent of S-B1's no-op path.
    const noop = { state: state0, dirtyIds: new Set<BlockId>() };
    expect(() => history.commit(noop, { before, after })).not.toThrow();
    expect(history.canUndo()).toBe(false);

    // The no-op must NOT have partially mutated (pushed a selection entry /
    // advanced currentState): a subsequent REAL commit + undo round-trips
    // cleanly. If the no-op had pushed an unmatched selection entry, this
    // real commit would trip the alignment assertion.
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

  it("destroy() disposes the UndoManager and detaches its observers", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    history.commit(setBlockAttrs(state0, child.id, { bold: true }), {
      before: sel,
      after: sel,
    });
    // Drain the undo stack so it is empty, then destroy.
    history.undo();
    expect(history.canUndo()).toBe(false);

    expect(() => history.destroy()).not.toThrow();

    // A post-destroy tracked mutation must NOT push a new entry onto the (now
    // empty) undo stack: proves the afterTransaction observer was detached. If
    // it were still live, this op would make canUndo() true again.
    setBlockAttrs(state0, child.id, { italic: true });
    expect(history.canUndo()).toBe(false);
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

    // #420: open a fresh non-coalescing "command" group per commit so the two
    // commits remain distinct undo entries (commit no longer owns boundaries).
    history.beginEntry("command", 0);
    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    const sel1Before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const sel1After = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(r1, { before: sel1Before, after: sel1After });

    history.beginEntry("command", 1);
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

    // #420: open a fresh non-coalescing "command" group per commit so all three
    // commits remain distinct undo entries (commit no longer owns boundaries).
    history.beginEntry("command", 0);
    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    history.commit(r1, { before: p0, after: p1 });
    history.beginEntry("command", 1);
    const r2 = setBlockAttrs(state0, child.id, { bold: true, italic: true });
    history.commit(r2, { before: p1, after: p2 });
    history.beginEntry("command", 2);
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

  it("undoes a listDef write atomically (Task 5)", () => {
    // The listDefs config side-table is a 4th tracked UndoManager scope
    // (history.ts). It is intentionally NOT a dirty-capture dimension
    // (captureDirtyIds only scans the block trees), so a listDefs-only op
    // yields empty dirtyIds and History.commit would no-op. To exercise the
    // undo path we mutate a real block in the SAME op so dirtyIds is non-empty
    // (the natural workaround documented in the task); the listDef revert is
    // what we assert. Asserted at the raw Y.Doc level via getListDef.
    const state = createEmptyDocument();
    const doc = state[STATE_INTERNAL].doc;
    const child = firstChild(state);
    const sample: ListDef = {
      levels: [
        { style: "decimal", start: 1, restart: "after-break" },
        { style: "lower-alpha", start: 1, restart: "after-break" },
      ],
    };

    expect(getListDef(doc, "L1")).toBeUndefined();

    const history = createHistory(state);
    const opResult = applyOperation(state, () => {
      writeListDefInTx(doc, "L1", sample);
      // Co-mutate a real block so dirtyIds is non-empty (listDefs is not a
      // dirty-capture dimension); this keeps both writes in one undo group.
      getYBlock(doc, child.id, "test").set("type", "heading");
    });
    expect(getListDef(doc, "L1")).toEqual(sample);

    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    history.commit(opResult, { before: sel, after: sel });
    expect(history.canUndo()).toBe(true);

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    // The listDef write is reverted atomically with the block mutation.
    expect(getListDef(doc, "L1")).toBeUndefined();

    // Redo re-applies the listDef.
    const redone = history.redo();
    expect(redone).not.toBeNull();
    if (redone === null) throw new Error("expected redo to succeed");
    expect(getListDef(doc, "L1")).toEqual(sample);
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

  it("undo() error-recovery: if undoManager.undo throws, history stays consistent and a retry round-trips (T33)", () => {
    // Monkey-patch undoManager.undo to throw ONCE. Cleanup happens in two
    // layers: captureDirtyIds (which wraps undoManager.undo) detaches
    // its afterTransaction listener in its own `finally`; the outer
    // History.undo() body's try/catch (per plan §T33 step 33.2) catches
    // the rethrown error and surfaces a wrapped message. On any throw the
    // Yjs stacks must remain untouched (undo never mutated them since it
    // threw before popping) so a subsequent retry succeeds normally.
    //
    // S-F2: selection now lives on the popped StackItem's `.meta`, so there
    // is no parallel array to verify; the surviving contract is observed
    // through behavior — canUndo() stays true and the retried undo returns
    // the correct `before` selection.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });

    type UndoView = { undoManager: { undo: () => unknown } };
    const internals = history as unknown as UndoView;
    const realUndo = internals.undoManager.undo.bind(internals.undoManager);
    internals.undoManager.undo = () => {
      throw new Error("simulated Yjs failure");
    };

    expect(() => history.undo()).toThrow(/failed mid-operation/);
    // The Yjs undo stack is untouched (undo threw before popping), so a
    // retry can still undo.
    expect(history.canUndo()).toBe(true);

    // Restore the real undo and retry: it round-trips with the correct
    // `before` selection — proving no desync was introduced.
    internals.undoManager.undo = realUndo;
    const retried = history.undo();
    expect(retried).not.toBeNull();
    if (retried === null) throw new Error("expected retry undo to succeed");
    expect(retried.selection).toEqual(before);
    expect(getBlock(retried.state, child.id)?.attrs.bold).toBeUndefined();
  });

  it("redo() error-recovery: if undoManager.redo throws, history stays consistent and a retry round-trips (T33)", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const opResult = setBlockAttrs(state0, child.id, { bold: true });
    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    history.commit(opResult, { before, after });
    // Move the entry onto the redo stack so the redo() path is exercised.
    history.undo();

    type RedoView = { undoManager: { redo: () => unknown } };
    const internals = history as unknown as RedoView;
    const realRedo = internals.undoManager.redo.bind(internals.undoManager);
    internals.undoManager.redo = () => {
      throw new Error("simulated Yjs failure");
    };

    expect(() => history.redo()).toThrow(/failed mid-operation/);
    expect(history.canRedo()).toBe(true);

    internals.undoManager.redo = realRedo;
    const retried = history.redo();
    expect(retried).not.toBeNull();
    if (retried === null) throw new Error("expected retry redo to succeed");
    expect(retried.selection).toEqual(after);
    expect(getBlock(retried.state, child.id)?.attrs.bold).toBe(true);
  });

  it("mutate-then-throw-before-commit leaves history desync-free; undo/redo behave (#318)", () => {
    // S-F2 regression. The paste.ts multi-line path runs `applyOperation`
    // (mutating the doc — Yjs creates an undo StackItem AND clears its own
    // redoStack in its afterTransaction handler) and then can throw on a
    // "contractually impossible" invariant guard BEFORE reaching
    // history.commit. Under the old parallel-array model that left the
    // redo selection stack desynced from Yjs's redoStack and tripped a
    // spurious dev alignment assertion. With the selection welded to the
    // StackItem's `.meta`, there is no second array to desync.
    //
    // Construct the scenario directly: commit a real action (so a redo
    // entry can exist), undo it (now canRedo() is true and Yjs holds a
    // redo StackItem with its `.meta`), then perform a tracked mutation
    // WITHOUT calling commit (simulating the handler that mutated then
    // threw). Yjs's afterTransaction clears its redoStack on that new
    // tracked edit. canRedo() must now be false (the real Yjs stack is the
    // source of truth) and undo/redo must still return correct selections.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    const before = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));
    const after = createSpan(createPosition(child.id, 1), createPosition(child.id, 1));
    const r1 = setBlockAttrs(state0, child.id, { bold: true });
    history.commit(r1, { before, after });

    // Undo → entry travels to redo; Yjs holds a redo StackItem.
    const undone = history.undo();
    expect(undone).not.toBeNull();
    expect(history.canRedo()).toBe(true);

    // Now mutate the doc through a tracked transaction but DO NOT commit —
    // this is the "applyOperation then throw before commit" shape. Yjs's
    // afterTransaction handler clears its own redoStack on this edit.
    applyOperation(state0, () => {
      getYBlock(state0[STATE_INTERNAL].doc, child.id, "test").set(
        "attrs",
        new Y.Map<unknown>(),
      );
    });

    // No spurious assertion. canRedo() reflects Yjs's now-cleared redoStack.
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();

    // And a fresh commit + undo still round-trips with the correct
    // before-selection read off the new StackItem's `.meta`.
    const sel2Before = createSpan(createPosition(child.id, 2), createPosition(child.id, 2));
    const sel2After = createSpan(createPosition(child.id, 3), createPosition(child.id, 3));
    const r2 = setBlockAttrs(state0, child.id, { italic: true });
    history.commit(r2, { before: sel2Before, after: sel2After });
    const u2 = history.undo();
    expect(u2).not.toBeNull();
    if (u2 === null) throw new Error("expected undo to succeed");
    expect(u2.selection).toEqual(sel2Before);
  });

  it("DEV: commit on a no-op opResult silently returns and does not grow the undo stack", () => {
    // No-op opResults (`dirtyIds.size === 0`) used to throw in dev mode as a
    // belt-and-suspenders for the (since-codified) handler-level T7 identity
    // short-circuit. That contract has been relaxed: commit silently drops the
    // no-op in BOTH dev and prod — there is no StackItem produced by Yjs's
    // no-op group, so there is nothing to record. The handler-side T7 guard
    // (`result.state === editor.state`) remains the conventional first stop;
    // commit is the safe backstop.
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = firstChild(state0);

    // Synthesize a no-op OperationResult by re-using `state0` and
    // passing an empty dirtyIds set.
    const noopResult = { state: state0, dirtyIds: new Set<BlockId>() };
    const sel = createSpan(createPosition(child.id, 0), createPosition(child.id, 0));

    expect(() =>
      history.commit(noopResult, { before: sel, after: sel }),
    ).not.toThrow();

    // No StackItem was produced — this is Yjs's documented no-op-group
    // behavior, unchanged by the relaxed commit contract.
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("DEV: a no-op commit (with NODE_ENV=development explicitly stubbed) returns safely and does not clobber the prior item's selection", () => {
    // Mirror of the PROD test below, with NODE_ENV explicitly set to a
    // development value to guarantee `isDevMode() === true`. With the
    // paper "dev throws on no-op" contract removed, dev mode behaves
    // identically to prod for the no-op-safe contract: silent return,
    // no StackItem produced, prior selection untouched.
    vi.stubEnv("NODE_ENV", "development");
    try {
      const state0 = createEmptyDocument();
      const history = createHistory(state0);
      const child = firstChild(state0);

      const r1 = setBlockAttrs(state0, child.id, { testMark: "x" });
      const selA = createSpan(
        createPosition(child.id, 0),
        createPosition(child.id, 0),
      );
      history.commit(r1, { before: selA, after: selA });

      const posB = createPosition(child.id, 1);
      const selB = createSpan(posB, posB);
      const noop = { state: r1.state, dirtyIds: new Set<BlockId>() };
      expect(() =>
        history.commit(noop, { before: selB, after: selB }),
      ).not.toThrow();

      // Undo returns selA, proving the no-op did not clobber it with selB.
      const undone = history.undo();
      expect(undone?.selection).toEqual(selA);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("PROD: a no-op commit returns safely without corrupting the prior item's selection (#264)", () => {
    // In production the dev throw is compiled away; the guard must still
    // protect the prior StackItem's selection. Without the production
    // backstop, a no-op commit would weld THIS call's selection onto the
    // previous action's top item (Yjs created no new item), silently
    // corrupting it. The fix returns early instead.
    vi.stubEnv("NODE_ENV", "production");
    try {
      const state0 = createEmptyDocument();
      const history = createHistory(state0);
      const child = firstChild(state0);

      // A real edit → commit with selection A.
      const r1 = setBlockAttrs(state0, child.id, { testMark: "x" });
      expect(r1.dirtyIds.size).toBeGreaterThan(0);
      const selA = createSpan(
        createPosition(child.id, 0),
        createPosition(child.id, 0),
      );
      history.commit(r1, { before: selA, after: selA });

      // A no-op commit in PRODUCTION must NOT throw and must NOT overwrite
      // selA on the top StackItem.
      const posB = createPosition(child.id, 1);
      const selB = createSpan(posB, posB);
      const noop = { state: r1.state, dirtyIds: new Set<BlockId>() };
      expect(() =>
        history.commit(noop, { before: selB, after: selB }),
      ).not.toThrow();

      // Undo returns selA (the real action's pre-selection), proving the
      // no-op did not clobber it with selB.
      const undone = history.undo();
      expect(undone?.selection).toEqual(selA);
    } finally {
      vi.unstubAllEnvs();
    }
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
    // #420: commit no longer owns undo boundaries — open a fresh "command"
    // group per commit (production always calls beginEntry via the reducer;
    // "command" never coalesces, so each commit stays its own undo entry, which
    // is exactly what these depth-cap tests assert). The injected time is
    // arbitrary because "command" never merges.
    history.beginEntry("command", v);
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

  it("front-trim under the .meta model returns the correct per-entry before-selection at the trim boundary (#318)", () => {
    // S-F2: with the selection welded to the StackItem's `.meta`, the
    // maxDepth front-trim (`undoManager.undoStack.splice(0, excess)`)
    // carries each trimmed item's selection away automatically — no
    // parallel array to splice in lockstep. This test gives every commit a
    // DISTINCT before/after pair (unlike commitV's aliased pair) so we can
    // prove the surviving items still carry their OWN selection after trim.
    let state = createEmptyDocument();
    const childId = firstChildOf(state);
    const history = createHistory(state, 2);

    const mkSel = (off: number) =>
      createSpan(createPosition(childId, off), createPosition(childId, off));

    // Four commits with distinct before/after selections; cap = 2 trims the
    // two oldest groups (v:1, v:2), retaining the v:2→v:3 and v:3→v:4 groups.
    const commits = [
      { v: 1, before: mkSel(0), after: mkSel(1) },
      { v: 2, before: mkSel(1), after: mkSel(2) },
      { v: 3, before: mkSel(2), after: mkSel(3) },
      { v: 4, before: mkSel(3), after: mkSel(4) },
    ];
    for (const c of commits) {
      // #420: open a fresh non-coalescing "command" group per commit (see
      // commitV) so each remains its own undo entry.
      history.beginEntry("command", c.v);
      const r = setBlockAttrs(state, childId, { v: c.v });
      history.commit(r, { before: c.before, after: c.after });
      state = r.state;
    }

    // Undo the v:3→v:4 group: returns its OWN before-selection (offset 3).
    const u1 = history.undo();
    if (u1 === null) throw new Error("expected undo 1");
    expect(u1.selection).toEqual(mkSel(3));

    // Undo the v:2→v:3 group: returns its before-selection (offset 2).
    const u2 = history.undo();
    if (u2 === null) throw new Error("expected undo 2");
    expect(u2.selection).toEqual(mkSel(2));

    // The two oldest groups were trimmed; their `.meta` rode away with them.
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();

    // Redo back up: each returns its OWN after-selection.
    const r1 = history.redo();
    if (r1 === null) throw new Error("expected redo 1");
    expect(r1.selection).toEqual(mkSel(3));
    const r2 = history.redo();
    if (r2 === null) throw new Error("expected redo 2");
    expect(r2.selection).toEqual(mkSel(4));
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

describe("History — typing coalescing (#420)", () => {
  // Build an empty one-paragraph doc and return its first leaf block id.
  function freshDocWithParagraph(): {
    state: ReturnType<typeof createEmptyDocument>;
    blockId: BlockId;
  } {
    const state = createEmptyDocument();
    const root = getBlock(state, state.rootId);
    if (root === null || root.firstChildId === null) {
      throw new Error("test fixture: missing first child");
    }
    return { state, blockId: root.firstChildId };
  }

  // Read the first leaf block's full text via a content-wide span.
  function extractFirstLeafText(
    state: ReturnType<typeof createEmptyDocument>,
    blockId: BlockId,
  ): string {
    const block = getBlock(state, blockId);
    if (block === null) throw new Error("test fixture: missing block");
    const len =
      block.inlineContent === null ? 0 : inlineContentLength(block.inlineContent);
    return extractText(
      state,
      createSpan(createPosition(blockId, 0), createPosition(blockId, len)),
    );
  }

  // Apply one insert at the given offset, returning the new state. Mirrors the
  // production flow: beginEntry(key, now) BEFORE the op, then commit after.
  function typeChar(
    history: History,
    state: ReturnType<typeof createEmptyDocument>,
    blockId: BlockId,
    offset: number,
    ch: string,
    key: "insert" | "delete" | "command",
    now: number,
  ): ReturnType<typeof createEmptyDocument> {
    history.beginEntry(key, now);
    const before = createSpan(
      createPosition(blockId, offset),
      createPosition(blockId, offset),
    );
    const result = insertText(state, createPosition(blockId, offset), ch, {});
    const after = createSpan(
      createPosition(blockId, offset + ch.length),
      createPosition(blockId, offset + ch.length),
    );
    history.commit(result, { before, after });
    return result.state;
  }

  it("coalesces consecutive same-kind inserts within the pause window into ONE undo entry", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "insert", 0);
    state = typeChar(history, state, blockId, 1, "b", "insert", 10);
    state = typeChar(history, state, blockId, 2, "c", "insert", 20);
    // One undo removes the whole "abc" run.
    expect(extractFirstLeafText(state, blockId)).toBe("abc");
    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(undone.state, blockId)).toBe("");
    expect(history.canUndo()).toBe(false);
  });

  it("a pause >= UNDO_COALESCE_PAUSE_MS splits the run into two undo entries", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "insert", 0);
    // gap == threshold => split (the merge predicate is strictly `<`).
    state = typeChar(history, state, blockId, 1, "b", "insert", UNDO_COALESCE_PAUSE_MS);
    let u = history.undo();
    if (u === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u.state, blockId)).toBe("a"); // first undo removes "b"
    u = history.undo();
    if (u === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u.state, blockId)).toBe(""); // second removes "a"
  });

  it("a kind switch (insert -> delete) splits into two undo entries", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "insert", 0);
    state = typeChar(history, state, blockId, 1, "b", "insert", 5);
    // delete the "b" (a coalescible delete) — kind switch from insert.
    history.beginEntry("delete", 10);
    const delResult = deleteRange(
      state,
      createSpan(createPosition(blockId, 1), createPosition(blockId, 2)),
    );
    history.commit(delResult, {
      before: createSpan(createPosition(blockId, 2), createPosition(blockId, 2)),
      after: createSpan(createPosition(blockId, 1), createPosition(blockId, 1)),
    });
    state = delResult.state;
    expect(extractFirstLeafText(state, blockId)).toBe("a");
    const u1 = history.undo(); // reverses the delete run
    if (u1 === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u1.state, blockId)).toBe("ab");
    const u2 = history.undo(); // reverses the insert run
    if (u2 === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u2.state, blockId)).toBe("");
  });

  it("a command key never coalesces (each is its own undo entry)", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "command", 0);
    state = typeChar(history, state, blockId, 1, "b", "command", 5); // < window, but command never merges
    expect(history.undo()).not.toBeNull(); // removes "b"
    expect(history.undo()).not.toBeNull(); // removes "a"
  });

  it("breakCoalescing() closes the open group so the next insert is a fresh entry", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "insert", 0);
    history.breakCoalescing();
    state = typeChar(history, state, blockId, 1, "b", "insert", 5); // same window, but break forced a split
    const u1 = history.undo();
    if (u1 === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u1.state, blockId)).toBe("a");
    const u2 = history.undo();
    if (u2 === null) throw new Error("expected undo to succeed");
    expect(extractFirstLeafText(u2.state, blockId)).toBe("");
  });

  it("a coalesced run keeps the group's ORIGINAL before-selection and the LATEST after-selection", () => {
    let { state, blockId } = freshDocWithParagraph();
    const history = createHistory(state);
    state = typeChar(history, state, blockId, 0, "a", "insert", 0); // before = offset 0
    state = typeChar(history, state, blockId, 1, "b", "insert", 5); // after = offset 2
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to succeed");
    // undo restores the caret to BEFORE the first keystroke (offset 0), not offset 1.
    expect(undone.selection?.focus.offset).toBe(0);
    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to succeed");
    // redo restores the caret to AFTER the last keystroke (offset 2).
    expect(redone.selection?.focus.offset).toBe(2);
  });
});

describe("History.advanceState — C1 stale-snapshot hazard (slice 2 piece C)", () => {
  const BLOCK_A = "a" as BlockId;
  const BLOCK_B = "b" as BlockId;

  /** doc > [ a("AAA"), b("BBB") ] */
  function twoBlockDoc(): ReturnType<typeof buildState> {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "a", lastChildId: "b" }),
        buildBlock({
          id: "a",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "b",
          inlineContent: inlineContent([text("AAA")]),
        }),
        buildBlock({
          id: "b",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "a",
          inlineContent: inlineContent([text("BBB")]),
        }),
      ],
    });
  }

  /**
   * A non-undoable resolve that mutates block B: stamps `{ resolved: true }`
   * onto B's attrs under SUGGESTION_RESOLVE_ORIGIN (the txn the slice-3
   * accept/reject ops produce — origin-tagged, undo-manager-invisible).
   */
  function resolveOnB(state: ReturnType<typeof buildState>) {
    return applyOperation(
      state,
      (doc) => {
        setBlockAttrsInTx(doc, BLOCK_B, { resolved: true }, "test-resolve");
        return new Set<BlockId>([BLOCK_B]);
      },
      { origin: SUGGESTION_RESOLVE_ORIGIN },
    );
  }

  it("after a non-undoable resolve on block B, undoing the prior block-A edit still reflects the resolve in B", () => {
    const s0 = twoBlockDoc();
    const history = createHistory(s0);

    // (2) Normal tracked edit on block A: insert "X" at offset 0 → "XAAA".
    history.beginEntry("insert", 0);
    const edit1 = insertText(s0, createPosition(BLOCK_A, 0), "X", {});
    history.commit(edit1, { before: null, after: null });

    // Read block B from the PRE-resolve snapshot so it is CACHED as "BBB" with no
    // `resolved` attr. This is what makes the C1 staleness observable: a stale
    // `currentState` then has block B already snapshotted pre-resolve, and the
    // undo's `freshState(currentState, dirtyIds)` overlay serves that cached
    // snapshot for any block the undo did not re-dirty (here, B).
    expect(getBlock(edit1.state, BLOCK_B)?.attrs.resolved).toBeUndefined();

    // (3) Non-undoable resolve that changes block B (origin-tagged, skips commit)
    // + advanceState to reconcile History's cached currentState to the
    // POST-resolve snapshot.
    const resolve = resolveOnB(edit1.state);
    history.advanceState(resolve.state);

    // (4) Undo the block-A edit from step 2. The undo's dirty set is {A} (only A
    // was reversed), so block B is served from `currentState`'s overlay base.
    // With advanceState, that base is the POST-resolve cache → B carries the
    // resolve. A reverts to "AAA" (length 3).
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const blockA = getBlock(undone.state, BLOCK_A);
    const blockB = getBlock(undone.state, BLOCK_B);
    if (blockA === null || blockB === null) throw new Error("missing block");
    if (blockA.inlineContent === null) throw new Error("missing block-A content");
    expect(inlineContentLength(blockA.inlineContent)).toBe(3); // "AAA"
    expect(blockB.attrs.resolved).toBe(true);
    // Proven by manual removal: deleting the `history.advanceState(resolve.state)`
    // call above makes the `expect(blockB.attrs.resolved).toBe(true)` assertion
    // FAIL — the undo's `freshState(stale-currentState=edit1.state, {A})` overlays
    // the PRE-resolve cache (where B was snapshotted above), so block B (not
    // re-dirtied by the undo) is served the stale no-`resolved` snapshot even
    // though the live Y.Doc holds the resolve. advanceState reconciles
    // currentState to the post-resolve cache so the overlay serves the fresh B.
    // (This is the exact silent-stale-render C1 hazard the design review caught.)
  });

  // E4b (collab undo isolation): a History created with a peer `trackedOrigin`
  // captures ONLY that peer's own edits. A remote peer's edit (a DIFFERENT origin,
  // here applied via the ambient `runWithTransactionOrigin`) lands on the shared
  // doc but must NOT enter this editor's undo stack.
  it("a collab History tracks only its own peer origin's edits (foreign edits are not undoable)", () => {
    const s0 = twoBlockDoc();
    const history = createHistory(s0, undefined, "peerA"); // this editor IS peerA

    // A FOREIGN peer's edit (origin "peerB") on the shared doc — not tracked.
    runWithTransactionOrigin("peerB", () => {
      insertText(s0, createPosition(BLOCK_B, 0), "Z", {});
    });
    expect(history.canUndo()).toBe(false);

    // peerA's OWN edit (origin "peerA") — tracked, so undoable.
    runWithTransactionOrigin("peerA", () => {
      insertText(s0, createPosition(BLOCK_A, 0), "X", {});
    });
    expect(history.canUndo()).toBe(true);
  });
});
