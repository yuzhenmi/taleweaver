/**
 * Object-delete wiring (#525 T7). An object selection is a COLLAPSED `Selection`
 * on an atomic-leaf block (`{ blockId, 0 }`). DELETE_FORWARD / DELETE_BACKWARD
 * on an object selection remove the selected image AS A UNIT (Google Docs) via
 * `deleteObjectSelection` — a hard `removeBlock` in BOTH direct and suggesting
 * mode (whole-block deletion-as-suggestion does not exist for any atomic block;
 * matches the pre-existing `deleteAdjacentAtomicLeaf` boundary-delete).
 *
 * Behavior-level tests through the real reducer (`reduceEditor`). Fixtures are
 * built at the STATE layer (`buildState`) and wrapped into a real Y.Doc-backed
 * `EditorState` (`createEditorStateFromState`), then the object selection is set
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
import type { BlockId, Selection, State } from "../../state";
import { isObjectSelection } from "../../cursor/object-selection";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";
import { createEditorStateFromState } from "../editor-state";
import type { EditorConfig, EditorState } from "../editor-state";
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
function standardDoc(): State {
  return buildState({
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
function imageLastDoc(): State {
  return buildState({
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
function editorFrom(state: State, cfg: EditorConfig): EditorState {
  const editor = createEditorStateFromState(state, objectSelection(), cfg);
  expect(isObjectSelection(editor.state, editor.selection, componentRegistry)).toBe(IMAGE_ID);
  return editor;
}

function blockLengthOf(state: State, id: BlockId): number {
  const b = getBlock(state, id);
  if (b === null || b.inlineContent === null) return 0;
  return b.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text.length : 1))
    .reduce((a, n) => a + n, 0);
}

describe("DELETE_FORWARD / DELETE_BACKWARD on an object selection (#525 T7)", () => {
  it("DELETE_FORWARD removes the image and lands the caret at the following block's start", () => {
    const editor = editorFrom(standardDoc(), config);

    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    expect(getBlock(next.state, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("DELETE_FORWARD is one undo entry; undo restores the image AND the object selection", () => {
    const editor = editorFrom(standardDoc(), config);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);
    expect(getBlock(next.state, IMAGE_ID)).toBeNull();

    const undone = reduceEditor(next, { type: "UNDO" }, config);
    expect(getBlock(undone.state, IMAGE_ID)?.type).toBe("image");
    expect(isObjectSelection(undone.state, undone.selection, componentRegistry)).toBe(IMAGE_ID);

    // A SECOND undo is a no-op (history exhausted — the delete was ONE entry):
    // the image and the object selection stay put.
    const undoneAgain = reduceEditor(undone, { type: "UNDO" }, config);
    expect(getBlock(undoneAgain.state, IMAGE_ID)?.type).toBe("image");
    expect(isObjectSelection(undoneAgain.state, undoneAgain.selection, componentRegistry)).toBe(
      IMAGE_ID,
    );
  });

  it("DELETE_BACKWARD removes the image (same removal) and lands the caret on the following block", () => {
    const editor = editorFrom(standardDoc(), config);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(getBlock(next.state, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(TRAILING_ID);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("DELETE_BACKWARD on a LAST-block image lands the caret at the preceding block's end", () => {
    const editor = editorFrom(imageLastDoc(), config);
    const precedingLen = blockLengthOf(editor.state, PARA_ID);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(getBlock(next.state, IMAGE_ID)).toBeNull();
    expect(next.selection.focus.blockId).toBe(PARA_ID);
    expect(next.selection.focus.offset).toBe(precedingLen);
    expect(precedingLen).toBe("above".length);
  });

  it("SUGGESTING MODE: object DELETE_BACKWARD HARD-removes the image (not soft-deleted)", () => {
    const editor = editorFrom(standardDoc(), suggestingConfig);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // The image is genuinely gone — whole-block deletion-as-suggestion does not
    // exist for an atomic block (matches deleteAdjacentAtomicLeaf).
    expect(getBlock(next.state, IMAGE_ID)).toBeNull();
  });

  it("SUGGESTING MODE: object DELETE_FORWARD HARD-removes the image (not soft-deleted)", () => {
    const editor = editorFrom(standardDoc(), suggestingConfig);

    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Symmetric to DELETE_BACKWARD: hard removal, no deletion-as-suggestion for
    // a whole atomic block.
    expect(getBlock(next.state, IMAGE_ID)).toBeNull();
  });

  it("REGRESSION: a normal text caret (not an object selection) still deletes a char on DELETE_BACKWARD", () => {
    // The guard must fire ONLY for object selections — a plain mid-word caret
    // backspace behaves exactly as before.
    let s = reduceEditor(
      createEditorStateFromState(standardDoc(), objectSelection(), config),
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(PARA_ID, 5), createPosition(PARA_ID, 5)),
      },
      config,
    );
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);

    const para = getBlock(s.state, PARA_ID);
    const txt = (para?.inlineContent?.items ?? [])
      .map((it) => (it.kind === "text" ? it.text : ""))
      .join("");
    expect(txt).toBe("abov"); // "above" → backspace at offset 5 → "abov"
    expect(getBlock(s.state, IMAGE_ID)?.type).toBe("image");
  });
});
