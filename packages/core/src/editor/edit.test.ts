import { describe, it, expect } from "vitest";
import { stateWithText, firstChildId, type Editor, createPosition, createSpan } from "./actions/test-helpers";
import { applyEdit, type Edit } from "./edit";
import { getBlock, mergeBlockAttrs, positionsEqual } from "../state";
import type { BlockId } from "../state";

/** A one-paragraph editor with an open undo entry, as the reducer has before an edit runs. */
function seeded(): { editor: Editor; id: BlockId } {
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

    const before = { ...editor };
    applyEdit(editor, { change, selection: after });
    expect(editor.document).toBe(change.document);
    expect(editor.selection).toBe(after);
    expect(editor.lastDirtyIds).toBe(change.dirtyIds);
    expect(editor.lastChange?.from).toBe(before.document);

    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, id)?.attrs.textAlign).toBeUndefined();
    expect(positionsEqual(editor.selection.focus, before.selection.focus)).toBe(true);
  });

  it("null — or a change that leaves the document as it was — commits and records nothing", () => {
    const { editor, id } = seeded();
    const before = { ...editor };
    applyEdit(editor, null);
    expect({ ...editor }).toEqual(before);
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);

    const after = createSpan(createPosition(id, 0), createPosition(id, 0));
    applyEdit(editor, { change: { document: editor.document, dirtyIds: new Set() }, selection: after });
    expect(editor.document).toBe(before.document);
    expect(editor.lastChange).toBe(before.lastChange);
    expect(editor.selection).toBe(after);
  });

  it("an Editor is not an Edit (it would silently lose its change)", () => {
    const { editor } = seeded();
    const asEdit = (edit: Edit): Edit => edit;
    // @ts-expect-error — `Edit.document?: never` rejects a whole Editor
    expect(() => asEdit(editor)).not.toThrow();
  });
});
