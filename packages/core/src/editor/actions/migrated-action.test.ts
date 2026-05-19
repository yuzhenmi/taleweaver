import { describe, it, expect } from "vitest";
import {
  createMockShaper,
  createRegistry,
  defaultComponents,
} from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor-state";
import { migratedAction, type MigratedActionResult } from "./migrated-action";
import { downgradeToStateNode } from "../rebuild-state-from-legacy";
import { structurallyEqualStateNode } from "./equivalence-test-utils";

const measurer = createMockShaper(8, 16);
const registry = createRegistry([...defaultComponents]);
const config: EditorConfig = { measurer, registry, containerWidth: 200 };

/**
 * Create an editor with non-empty content so the legacy↔new bridge can
 * round-trip cursor positions. The initial-state's empty paragraph has
 * no text child, while `downgradeToStateNode` of the rebuilt state also
 * produces an empty paragraph — the cursor at path [0,0] can't walk into
 * that. Typing a single character gives the paragraph a text child and
 * rebuilds the new state via the reducer's post-action sync.
 */
function makeEditorWithContent(): EditorState {
  const initial = createInitialEditorState(config);
  return reduceEditor(initial, { type: "INSERT_TEXT", text: "a" }, config);
}

describe("migratedAction wrapper", () => {
  it("threads `state` from the callback into the output editor", () => {
    const editor = makeEditorWithContent();

    const result = migratedAction(editor, config, (state, selection): MigratedActionResult => {
      // No-op callback — returns the same state + the converted selection.
      return { state, selection };
    });

    // state field threaded through.
    expect(result.state).toBe(editor.state);
  });

  it("refreshes `stateLegacy` via downgradeToStateNode (different object, structurally equal to a fresh downgrade)", () => {
    const editor = makeEditorWithContent();

    const result = migratedAction(editor, config, (state, selection): MigratedActionResult => {
      return { state, selection };
    });

    // Wrapper produced a fresh stateLegacy via downgrade.
    expect(result.stateLegacy).not.toBe(editor.stateLegacy);
    // And the fresh stateLegacy matches what downgrade would produce
    // directly from the same input state.
    const expected = downgradeToStateNode(editor.state);
    expect(structurallyEqualStateNode(result.stateLegacy, expected)).toBe(true);
  });

  it("re-projects the post-action NewSpan back to a legacy Selection", () => {
    const editor = makeEditorWithContent();

    const result = migratedAction(editor, config, (state, selection): MigratedActionResult => {
      // Pass the selection through unchanged. The wrapper must convert
      // it back to a legacy Selection (path+offset) before storing.
      return { state, selection };
    });

    // Legacy Selection has anchor.path / focus.path (arrays); New Span
    // has anchor.blockId / focus.blockId (strings). After the wrapper
    // round-trips, anchor + focus must be legacy positions again.
    expect(Array.isArray(result.selection.anchor.path)).toBe(true);
    expect(Array.isArray(result.selection.focus.path)).toBe(true);
    expect(typeof result.selection.anchor.offset).toBe("number");
    expect(typeof result.selection.focus.offset).toBe("number");
    // Round-trip preserves the path/offset of the pre-action cursor.
    expect(result.selection.anchor.path).toEqual(editor.selection.anchor.path);
    expect(result.selection.anchor.offset).toBe(editor.selection.anchor.offset);
    expect(result.selection.focus.path).toEqual(editor.selection.focus.path);
    expect(result.selection.focus.offset).toBe(editor.selection.focus.offset);
  });

  it("pushes one entry onto historyLegacy.undoStack per call (no merge)", () => {
    const editor = makeEditorWithContent();
    const before = editor.historyLegacy.undoStack.length;

    const result = migratedAction(editor, config, (state, selection): MigratedActionResult => {
      // No mergeTag → never merges.
      return { state, selection };
    });

    expect(result.historyLegacy.undoStack.length).toBe(before + 1);
  });

  it("merges consecutive entries when mergeTag matches within the threshold", () => {
    const editor = makeEditorWithContent();
    const before = editor.historyLegacy.undoStack.length;

    // Use a tag distinct from any setup tag ("insert") so the first call
    // does NOT merge with whatever the setup left behind.
    const afterFirst = migratedAction(editor, config, (state, selection): MigratedActionResult => {
      return { state, selection, mergeTag: "test-merge" };
    });
    expect(afterFirst.historyLegacy.undoStack.length).toBe(before + 1);
    expect(afterFirst.historyLegacy.lastEditTag).toBe("test-merge");

    // Immediate second call with the same tag → merges into the first.
    const afterSecond = migratedAction(afterFirst, config, (state, selection): MigratedActionResult => {
      return { state, selection, mergeTag: "test-merge" };
    });

    expect(afterSecond.historyLegacy.undoStack.length).toBe(before + 1);
    expect(afterSecond.historyLegacy.lastEditTag).toBe("test-merge");
  });
});
