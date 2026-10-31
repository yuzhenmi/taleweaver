/**
 * Object-delete wiring. An object selection is a COLLAPSED `Selection`
 * on an atomic-leaf block (`{ blockId, 0 }`). DELETE_FORWARD / DELETE_BACKWARD
 * on an object selection remove the selected image AS A UNIT (Google Docs) via
 * `deleteObjectSelection` — a hard `removeBlock` in BOTH direct and suggesting
 * mode (whole-block deletion-as-suggestion does not exist for any atomic block;
 * matches the pre-existing `deleteAdjacentAtomicLeaf` boundary-delete).
 *
 * Behavior-level tests through the real reducer (`reduceEditor`). Fixtures are
 * built at the STATE layer (`buildDocument`) and wrapped into a real Y.Doc-backed
 * `EditorState` (`createEditorStateFromDocument`), then the object selection is set
 * via SET_SELECTION. Doc shapes:
 *   - standard:    [para "above"] [image] [trailing para]
 *   - image-last:  [para "above"] [image]
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  createPosition,
  createSpan,
  asBlockId,
} from "../../state";
import type { Selection, Document } from "../../state";
import { isObjectSelection } from "../../cursor/object-selection";
import {
  buildDocument,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/document-builders";
import { createEditorStateFromDocument } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import type { EditorState } from "../editor-state";
import { config, componentRegistry, reduceEditor } from "./test-helpers";

const IMAGE_ID = asBlockId("image");
const PARA_ID = asBlockId("para");
const TRAILING_ID = asBlockId("trailing");

/** A suggesting-mode config attributed to "alice" (direct config + author). */
const suggestingConfig: EditorConfig = { ...config, suggestingAuthor: "alice" };

/** Object selection: collapsed caret at offset 0 of the image. */
function objectSelection(): Selection {
  return createSpan(createPosition(IMAGE_ID, 0), createPosition(IMAGE_ID, 0));
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

/** Wrap a state into an editor with the image object-selected (active config). */
function editorFrom(document: Document, cfg: EditorConfig): EditorState {
  const editor = createEditorStateFromDocument(document, objectSelection(), cfg);
  expect(isObjectSelection(editor.document, editor.selection, componentRegistry)).toBe(IMAGE_ID);
  return editor;
}

describe("DELETE_FORWARD / DELETE_BACKWARD on an object selection", () => {
  it("DELETE_FORWARD removes the image and lands the caret at the following block's start", () => {
    const editor = editorFrom(standardDoc(), config);

    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("DELETE_FORWARD is one undo entry; undo restores the image AND the object selection", () => {
    const editor = editorFrom(standardDoc(), config);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, IMAGE_ID)).toBeNull();

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getBlock(undone.document, IMAGE_ID)?.type).toBe("image");
    expect(isObjectSelection(undone.document, undone.selection, componentRegistry)).toBe(IMAGE_ID);

    // A SECOND undo is a no-op (history exhausted — the delete was ONE entry):
    // the image and the object selection stay put.
    const undoneAgain = reduceEditor(undone, { type: "UNDO" });
    expect(getBlock(undoneAgain.document, IMAGE_ID)?.type).toBe("image");
    expect(isObjectSelection(undoneAgain.document, undoneAgain.selection, componentRegistry)).toBe(
      IMAGE_ID,
    );
  });

  it("DELETE_BACKWARD removes the image (same removal) and lands the caret on the following block", () => {
    const editor = editorFrom(standardDoc(), config);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("DELETE_BACKWARD on an image authored LAST lands the caret on the paragraph invariant I put after it", () => {
    // Invariant I: a paragraph always follows an object, so an image is
    // never the body's last block — the caret goes to that paragraph's start.
    const editor = editorFrom(imageLastDoc(), config);
    const after = getBlock(editor.document, IMAGE_ID)?.nextSiblingId ?? null;
    expect(after).not.toBeNull();

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });

    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
    expect(next.selection.focus).toEqual({ blockId: after, offset: 0 });
  });

  it("SUGGESTING MODE: object DELETE_BACKWARD HARD-removes the image (not soft-deleted)", () => {
    const editor = editorFrom(standardDoc(), suggestingConfig);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });

    // The image is genuinely gone — whole-block deletion-as-suggestion does not
    // exist for an atomic block (matches deleteAdjacentAtomicLeaf).
    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
  });

  it("SUGGESTING MODE: object DELETE_FORWARD HARD-removes the image (not soft-deleted)", () => {
    const editor = editorFrom(standardDoc(), suggestingConfig);

    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });

    // Symmetric to DELETE_BACKWARD: hard removal, no deletion-as-suggestion for
    // a whole atomic block.
    expect(getBlock(next.document, IMAGE_ID)).toBeNull();
  });

  it("REGRESSION: a normal text caret (not an object selection) still deletes a char on DELETE_BACKWARD", () => {
    // The guard must fire ONLY for object selections — a plain mid-word caret
    // backspace behaves exactly as before.
    let s = reduceEditor(
      createEditorStateFromDocument(standardDoc(), objectSelection(), config),
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(PARA_ID, 5), createPosition(PARA_ID, 5)),
      },
    );
    s = reduceEditor(s, { type: "DELETE_BACKWARD" });

    const para = getBlock(s.document, PARA_ID);
    const txt = (para?.inlineContent?.items ?? [])
      .map((it) => (it.kind === "text" ? it.text : ""))
      .join("");
    expect(txt).toBe("abov"); // "above" → backspace at offset 5 → "abov"
    expect(getBlock(s.document, IMAGE_ID)?.type).toBe("image");
  });
});
