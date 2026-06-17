/**
 * `EditorState.lastDirtyIds` — the geometry-free per-dispatch hand-off to the
 * print backend's layout-driver (Phase 0b). A MUTATING action records the set of
 * block ids it changed (a non-null, possibly-empty `Set`); a selection-only /
 * inert / no-op action yields `null` (a full-rebuild hint). `rebuildTrees` is the
 * SOLE writer of a non-null value, and `reduceEditor` ENTRY-CLEARS `lastDirtyIds`
 * to null before the action switch, so a prior mutating action's dirty ids never
 * leak forward onto a later selection-only action's state.
 *
 * These three cases pin that contract end-to-end through the public reducer.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  createPosition,
  createSpan,
} from "./actions/test-helpers";
import { getBlock } from "../state";
import type { BlockId } from "../state";

/** The first content block id of a fresh editor (the only paragraph). */
function firstBlockId(state: ReturnType<typeof createInitialEditorState>["state"]): BlockId {
  const root = getBlock(state, state.rootId);
  if (root === null || root.firstChildId === null) {
    throw new Error("last-dirty-ids.test: editor seed has no content block");
  }
  return root.firstChildId;
}

describe("EditorState.lastDirtyIds", () => {
  it("a mutating action (INSERT_TEXT) records a non-empty set containing the edited block", () => {
    const editor = createInitialEditorState(config);
    const blockId = firstBlockId(editor.state);

    const result = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);

    expect(result.lastDirtyIds).not.toBeNull();
    const dirty = result.lastDirtyIds;
    if (dirty === null) throw new Error("expected non-null lastDirtyIds");
    expect(dirty.size).toBeGreaterThan(0);
    expect(dirty.has(blockId)).toBe(true);
  });

  it("a standalone SET_SELECTION yields null (no incremental hint)", () => {
    const editor = createInitialEditorState(config);
    const blockId = firstBlockId(editor.state);
    const at = createPosition(blockId, 0);

    const result = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(at, at) },
      config,
    );

    expect(result.lastDirtyIds).toBeNull();
  });

  it("entry-clears stale dirty ids: a SET_SELECTION after an INSERT_TEXT yields null, not the inherited set", () => {
    const editor = createInitialEditorState(config);
    const blockId = firstBlockId(editor.state);

    // r1: a mutating action → a non-null block set.
    const r1 = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(r1.lastDirtyIds).not.toBeNull();

    // r2: a selection-only action dispatched ON r1. Without the reducer's
    // entry-clear, r2 would inherit r1's block set (the driver would then wrongly
    // rebuild only those blocks for a pure caret move). It must be null.
    const at = createPosition(blockId, 1);
    const r2 = reduceEditor(
      r1,
      { type: "SET_SELECTION", selection: createSpan(at, at) },
      config,
    );

    expect(r2.lastDirtyIds).toBeNull();
  });
});
