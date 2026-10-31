/**
 * `Editor.lastDirtyIds` — the geometry-free per-dispatch hand-off to the
 * print backend's layout-driver (Phase 0b). A MUTATING action records the set of
 * block ids it changed (a non-null, possibly-empty `Set`); a selection-only /
 * inert / no-op action yields `null` (a full-rebuild hint). `applyEdit` is the
 * SOLE writer of a non-null value, and `reduceEditor` ENTRY-CLEARS `lastDirtyIds`
 * to null before the action switch, so a prior mutating action's dirty ids never
 * leak forward onto a later selection-only action's state.
 *
 * These three cases pin that contract end-to-end through the public reducer.
 */
import { describe, it, expect } from "vitest";
import {
  config, createPosition, createSpan, createEditor } from "./actions/test-helpers";
import { topLevelBlockIds } from "../state";
import type { BlockId } from "../state";

/** The first content block id of a fresh editor (the only paragraph). */
function firstBlockId(document: ReturnType<typeof createEditor>["document"]): BlockId {
  const first = topLevelBlockIds(document)[0]; // the root holds sections
  if (first === undefined) {
    throw new Error("last-dirty-ids.test: editor seed has no content block");
  }
  return first;
}

describe("Editor.lastDirtyIds", () => {
  it("a mutating action (INSERT_TEXT) records a non-empty set containing the edited block", () => {
    const editor = createEditor(config);
    const blockId = firstBlockId(editor.document);

    editor.dispatch({ type: "INSERT_TEXT", text: "x" });

    expect(editor.lastDirtyIds).not.toBeNull();
    const dirty = editor.lastDirtyIds;
    if (dirty === null) throw new Error("expected non-null lastDirtyIds");
    expect(dirty.size).toBeGreaterThan(0);
    expect(dirty.has(blockId)).toBe(true);
  });

  it("a standalone SET_SELECTION yields null (no incremental hint)", () => {
    const editor = createEditor(config);
    const blockId = firstBlockId(editor.document);
    const at = createPosition(blockId, 0);

    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(at, at) });

    expect(editor.lastDirtyIds).toBeNull();
  });

  it("entry-clears stale dirty ids: a SET_SELECTION after an INSERT_TEXT yields null, not the inherited set", () => {
    const editor = createEditor(config);
    const blockId = firstBlockId(editor.document);

    // r1: a mutating action → a non-null block set.
    editor.dispatch({ type: "INSERT_TEXT", text: "x" });
    expect(editor.lastDirtyIds).not.toBeNull();

    // r2: a selection-only action dispatched ON r1. Without the reducer's
    // entry-clear, r2 would inherit r1's block set (the driver would then wrongly
    // rebuild only those blocks for a pure caret move). It must be null.
    const at = createPosition(blockId, 1);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(at, at) });

    expect(editor.lastDirtyIds).toBeNull();
  });
});
