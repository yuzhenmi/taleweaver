import { describe, it, expect } from "vitest";
import { stateWithText, firstChildId, reduceEditor, createPosition, createSpan, type EditorState } from "./actions/test-helpers";
import { applyEdit, type Edit } from "./edit";
import { getBlock, mergeBlockAttrs, positionsEqual } from "../state";
import type { BlockId } from "../state";

/** A one-paragraph editor with an open undo entry, as the reducer has before an edit runs. */
function seeded(): { editor: EditorState; id: BlockId } {
  const editor = stateWithText("hello");
  const id = firstChildId(editor.document);
  if (id === null) throw new Error("no paragraph");
  editor.history.beginEntry("command", Date.now(), editor.selection);
  return { editor, id };
}

describe("applyEdit", () => {
  it("commits a change as one undo entry carrying the selection before → after, and records it", () => {
    const { editor, id } = seeded();
    const change = mergeBlockAttrs(editor.document, id, { textAlign: "center" });
    const after = createSpan(createPosition(id, 1), createPosition(id, 1));

    const next = applyEdit(editor, { change, selection: after });
    expect(next.document).toBe(change.state);
    expect(next.selection).toBe(after);
    expect(next.lastDirtyIds).toBe(change.dirtyIds);
    expect(next.lastChange?.from).toBe(editor.document);

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getBlock(undone.document, id)?.attrs.textAlign).toBeUndefined();
    expect(positionsEqual(undone.selection.focus, editor.selection.focus)).toBe(true);
  });

  it("null — or a change that leaves the document as it was — commits and records nothing", () => {
    const { editor, id } = seeded();
    expect(applyEdit(editor, null)).toBe(editor);

    const after = createSpan(createPosition(id, 0), createPosition(id, 0));
    const moved = applyEdit(editor, { change: { state: editor.document, dirtyIds: new Set() }, selection: after });
    expect(moved.document).toBe(editor.document);
    expect(moved.lastChange).toBe(editor.lastChange);
    expect(moved.selection).toBe(after);
  });

  it("an EditorState is not an Edit (it would silently lose its change)", () => {
    const { editor } = seeded();
    const asEdit = (edit: Edit): Edit => edit;
    // @ts-expect-error — `Edit.document?: never` rejects a whole EditorState
    expect(() => asEdit(editor)).not.toThrow();
  });
});
