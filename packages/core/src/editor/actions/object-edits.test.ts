/**
 * Object-edit helpers (#525 T5). An object selection is a COLLAPSED `Selection`
 * on an atomic-leaf block (`{ blockId, 0 }`). These editor-layer helpers act on
 * the selected object:
 *   - `deleteObjectSelection` — remove the image as a unit, place a valid caret.
 *   - `replaceObjectWithText` — replace the image by typed text in ONE undo entry.
 *   - `moveOffObject` — a pure selection move off the object (no edit, no undo).
 *
 * Fixtures are built at the STATE layer (`buildDocument`) and wrapped into a real
 * Y.Doc-backed `EditorState` (`createEditorStateFromDocument`) so ops + History +
 * undo run end-to-end. Three doc shapes:
 *   - standard:    [para "above"] [image] [trailing para]
 *   - image-last:  [para "above"] [image]
 *   - image-only:  [image]
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  createPosition,
  createSpan,
  inlineContentLength,
  asBlockId,
} from "../../state";
import type { BlockId, Selection, Document } from "../../state";
import { isObjectSelection } from "../../cursor/object-selection";
import {
  buildDocument,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/document-builders";
import { createEditorStateFromDocument } from "../editor-state";
import type { EditorState } from "../editor-state";
import { applyEdit } from "../edit";
import { config, componentRegistry, reduceEditor } from "./test-helpers";
import { deleteObjectSelection } from "./helpers/delete-object-selection";
import { replaceObjectWithText } from "./helpers/replace-object-with-text";
import { moveOffObject } from "./helpers/move-off-object";

const IMAGE_ID = asBlockId("image");
const PARA_ID = asBlockId("para");
const TRAILING_ID = asBlockId("trailing");

/** Object selection: collapsed caret at offset 0 of the image. */
function objectSelection(): Selection {
  return createSpan(createPosition(IMAGE_ID, 0), createPosition(IMAGE_ID, 0));
}

function editorFrom(document: Document): EditorState {
  const editor = createEditorStateFromDocument(document, objectSelection(), config);
  expect(isObjectSelection(editor.document, editor.selection, componentRegistry)).toBe(IMAGE_ID);
  return editor;
}

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

/** [para "above"] [image] — the image is the LAST block. */
function imageLastDoc(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "para", lastChildId: "image" }),
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
        attrs: { src: "img.png" },
      }),
    ],
  });
}

/** [image] — the image is the ONLY content block. */
function imageOnlyDoc(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "image", lastChildId: "image" }),
      buildBlock({ id: "image", type: "image", parentId: "doc", attrs: { src: "img.png" } }),
    ],
  });
}

function blockLength(document: Document, id: BlockId): number {
  const b = getBlock(document, id);
  if (b === null || b.inlineContent === null) return 0;
  return inlineContentLength(b.inlineContent);
}

function textOf(document: Document, id: BlockId): string {
  const b = getBlock(document, id);
  return (b?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

describe("deleteObjectSelection (#525)", () => {
  it("removes the image and places the caret at the start of the following block", () => {
    const editor = editorFrom(standardDoc());
    const next = applyEdit(editor, deleteObjectSelection(editor, IMAGE_ID));

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("is one undo entry: undo restores the image AND the object selection", () => {
    const editor = editorFrom(standardDoc());
    const next = applyEdit(editor, deleteObjectSelection(editor, IMAGE_ID));
    expect(getBlock(next.document, IMAGE_ID)).toBeNull();

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getBlock(undone.document, IMAGE_ID)?.type).toBe("image");
    expect(isObjectSelection(undone.document, undone.selection, componentRegistry)).toBe(IMAGE_ID);
  });

  it("an image authored LAST still has a paragraph after it (invariant I): the caret lands at its start", () => {
    const editor = editorFrom(imageLastDoc());
    const after = getBlock(editor.document, IMAGE_ID)?.nextSiblingId ?? null;
    expect(after).not.toBeNull();

    const next = applyEdit(editor, deleteObjectSelection(editor, IMAGE_ID));

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(next.selection.focus).toEqual({ blockId: after, offset: 0 });
  });

  it("keeps the empty-doc invariant when the image is the only content block", () => {
    const editor = editorFrom(imageOnlyDoc());
    const next = applyEdit(editor, deleteObjectSelection(editor, IMAGE_ID));

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    // The caret must land on a real content-bearing leaf (a freshly seeded
    // paragraph), never the container root.
    const caretBlock = getBlock(next.document, next.selection.focus.blockId);
    expect(caretBlock).not.toBeNull();
    expect(caretBlock?.inlineContent).not.toBeNull();
    expect(next.selection.focus.blockId).not.toBe(next.document.rootId);
    expect(next.selection.focus.offset).toBe(0);
  });
});

describe("replaceObjectWithText (#525)", () => {
  it("replaces the image with the typed text at the following block's start, caret after it", () => {
    const editor = editorFrom(standardDoc());
    const next = applyEdit(editor, replaceObjectWithText(editor, IMAGE_ID, "x"));

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(textOf(next.document, TRAILING_ID).startsWith("x")).toBe(true);
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(1);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("is one undo entry restoring the image", () => {
    const editor = editorFrom(standardDoc());
    const next = applyEdit(editor, replaceObjectWithText(editor, IMAGE_ID, "x"));
    expect(getBlock(next.document, IMAGE_ID)).toBeNull();

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getBlock(undone.document, IMAGE_ID)?.type).toBe("image");
    // After ONE undo the typed text is gone too (single entry).
    expect(textOf(undone.document, TRAILING_ID)).toBe("");
  });
});

describe("moveOffObject (#525)", () => {
  it("forward: caret at the next content block's start, image intact, no new undo entry", () => {
    const editor = editorFrom(standardDoc());
    const canUndoBefore = editor.history.canUndo();

    const next = applyEdit(editor, moveOffObject(editor, IMAGE_ID, "forward"));

    expect(getBlock(next.document, IMAGE_ID)?.type).toBe("image");
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
    // Pure selection move: history + state reference untouched.
    expect(next.history.canUndo()).toBe(canUndoBefore);
    expect(next.document).toBe(editor.document);
  });

  it("backward: caret at the previous content block's end", () => {
    const editor = editorFrom(standardDoc());
    const prevLen = blockLength(editor.document, PARA_ID);

    const next = applyEdit(editor, moveOffObject(editor, IMAGE_ID, "backward"));

    expect(getBlock(next.document, IMAGE_ID)?.type).toBe("image");
    expect(next.selection.focus.blockId).toBe(PARA_ID);
    expect(next.selection.focus.offset).toBe(prevLen);
    expect(next.document).toBe(editor.document);
  });

  it("forward from an image authored last: the paragraph invariant I put after it takes the caret", () => {
    const editor = editorFrom(imageLastDoc());
    const after = getBlock(editor.document, IMAGE_ID)?.nextSiblingId ?? null;
    const next = applyEdit(editor, moveOffObject(editor, IMAGE_ID, "forward"));
    expect(next.selection.focus).toEqual({ blockId: after, offset: 0 });
  });

  it("backward with no preceding content block: keeps the caret on the object", () => {
    const editor = editorFrom(imageOnlyDoc());
    const next = applyEdit(editor, moveOffObject(editor, IMAGE_ID, "backward"));
    expect(next).toBe(editor);
  });
});
