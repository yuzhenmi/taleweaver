/**
 * Object-selection action-handler guards (#525 T6). When the selection is an
 * OBJECT selection (a collapsed caret at offset 0 of an atomic-leaf block — see
 * `isObjectSelection`), the text-editing action handlers must route to the T5
 * object-edit helpers instead of mis-operating on the atomic block:
 *   - INSERT_TEXT  → replaceObjectWithText (would otherwise THROW)
 *   - DELETE_WORD  → deleteObjectSelection  (would otherwise no-op)
 *   - SPLIT_NODE   → no-op (Enter on a selected object does nothing)
 *   - DELETE_RANGE → no-op (the backend DELETE_LINE intent resolves to nothing)
 *   - MOVE_WORD    → moveOffObject          (caret beside the object, not past it)
 *
 * Driven through `reduceEditor` on a real Y.Doc-backed Editor built from a
 * [para "above"] [image] [trailing para] fixture (mirrors object-edits.test.ts).
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  createPosition,
  createSpan,
  asBlockId,
} from "../../state";
import type { BlockId, Document } from "../../state";
import { isObjectSelection } from "../../cursor/object-selection";
import {
  buildDocument,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/document-builders";
import { createEditor } from "../editor";
import type { Editor } from "../editor";
import { config, componentRegistry } from "./test-helpers";

const IMAGE_ID = asBlockId("image");
const PARA_ID = asBlockId("para");
const TRAILING_ID = asBlockId("trailing");

/** [para "above"] [image] [trailing para] */
function standardDoc(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "para", lastChildId: "trailing" }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "image",
        inlineContent: inlineContent([text("above")]),
      }),
      buildBlock({
        id: "image",
        type: "image",
        parentId: "doc",
        prevSiblingId: "para",
        nextSiblingId: "trailing",
        attrs: { src: "img.png" },
      }),
      buildBlock({
        id: "trailing",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "image",
        inlineContent: inlineContent([]),
      }),
    ],
  });
}

/** Collapsed object selection on the image. */
function objectEditor(): Editor {
  const sel = createSpan(createPosition(IMAGE_ID, 0), createPosition(IMAGE_ID, 0));
  const editor = createEditor(config, { document: standardDoc(), selection: sel });
  expect(isObjectSelection(editor.document, editor.selection, componentRegistry)).toBe(IMAGE_ID);
  return editor;
}

function textOf(document: Document, id: BlockId): string {
  const b = getBlock(document, id);
  return (b?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

describe("object-selection action-handler guards (#525 T6)", () => {
  it("INSERT_TEXT replaces the object with the typed text (one undo entry), no throw", () => {
    const editor = objectEditor();
    let next: Editor | null = null;
    expect(() => {
      editor.dispatch({ type: "INSERT_TEXT", text: "x" });
        next = editor;
    }).not.toThrow();
    if (next === null) throw new Error("unreachable");
    const result: Editor = next;

    expect(getBlock(result.document, IMAGE_ID)).toBeNull();
    expect(textOf(result.document, TRAILING_ID).startsWith("x")).toBe(true);
    expect(result.selection.focus.blockId).toBe(TRAILING_ID);
    expect(result.selection.focus.offset).toBe(1);

    // ONE undo entry: a single UNDO restores the image AND drops the text.
    result.dispatch({ type: "UNDO" });
    expect(getBlock(result.document, IMAGE_ID)?.type).toBe("image");
    expect(textOf(result.document, TRAILING_ID)).toBe("");
  });

  it("DELETE_WORD removes the selected object (routed to object-delete)", () => {
    const editor = objectEditor();
    editor.dispatch({ type: "DELETE_WORD", direction: "forward" });
    expect(getBlock(editor.document, IMAGE_ID)).toBeNull();
    expect(editor.selection.focus.blockId).toBe(TRAILING_ID);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("SPLIT_NODE (Enter) on an object selection is a no-op (same editor reference)", () => {
    const editor = objectEditor();
    const before = editor.snapshot();
    editor.dispatch({ type: "SPLIT_NODE" });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
    expect(getBlock(editor.document, IMAGE_ID)?.type).toBe("image");
  });

  it("DELETE_RANGE over the collapsed object span is a no-op (same editor reference)", () => {
    // Phase 0b: the geometric DELETE_LINE intent now lives in the backend
    // NavIntent resolver, which returns `null` (dispatch nothing) for an object
    // selection. The geometry-free core action it would otherwise dispatch —
    // DELETE_RANGE over the object's collapsed span — is itself a no-op.
    const editor = objectEditor();
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_RANGE", span: editor.selection });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
    expect(getBlock(editor.document, IMAGE_ID)?.type).toBe("image");
  });

  it("MOVE_WORD forward places the caret AFTER the image (start of the following block)", () => {
    const editor = objectEditor();
    editor.dispatch({ type: "MOVE_WORD", direction: "forward" });
    expect(getBlock(editor.document, IMAGE_ID)?.type).toBe("image");
    expect(editor.selection.focus.blockId).toBe(TRAILING_ID);
    expect(editor.selection.focus.offset).toBe(0);
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });

  it("MOVE_WORD backward places the caret BEFORE the image (end of the preceding block)", () => {
    const editor = objectEditor();
    editor.dispatch({ type: "MOVE_WORD", direction: "backward" });
    expect(getBlock(editor.document, IMAGE_ID)?.type).toBe("image");
    expect(editor.selection.focus.blockId).toBe(PARA_ID);
    expect(editor.selection.focus.offset).toBe("above".length);
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });
});
