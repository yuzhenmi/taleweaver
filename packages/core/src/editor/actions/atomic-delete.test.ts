/**
 * Atomic-object deletion at a block boundary (#P11.3, Google Docs). Image /
 * horizontal-line are atomic-leaf blocks: they hold no cursor positions of
 * their own (`inlineContent === null`), so the grapheme-stepping delete
 * handlers walk straight past them. Backspace at the start of the block AFTER
 * an atomic block, and Delete at the end of the block BEFORE one, must remove
 * the atomic object as a unit (rather than no-op). The caret stays put.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
  createSpan,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

/** Build `[para "above"] [atomic] [empty trailing para]`, caret at trailing-para start. */
function docWithAtomicAfter(
  insert: { type: "INSERT_IMAGE"; src: string } | { type: "INSERT_HORIZONTAL_LINE" },
) {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" }, config);
  const paraId = firstChildId(editor.state) as BlockId;
  editor = reduceEditor(editor, insert, config);
  const atomicId = getBlock(editor.state, paraId)?.nextSiblingId as BlockId;
  const trailingId = getBlock(editor.state, atomicId)?.nextSiblingId as BlockId;
  return { editor, paraId, atomicId, trailingId };
}

describe("atomic-leaf delete behavior (#P11.3)", () => {
  it("Backspace at the start of the paragraph after an IMAGE deletes the image", () => {
    const { editor, paraId, atomicId, trailingId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    expect(getBlock(editor.state, atomicId)?.type).toBe("image");
    // INSERT_IMAGE leaves the caret at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // Image removed; the paragraph chain closes up around it.
    expect(getBlock(next.state, atomicId)).toBeNull();
    expect(getBlock(next.state, paraId)?.nextSiblingId).toBe(trailingId);
    expect(getBlock(next.state, trailingId)?.prevSiblingId).toBe(paraId);
    // Caret stays at the start of the trailing paragraph.
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("Backspace at the start of the paragraph after a HORIZONTAL-LINE deletes the rule", () => {
    const { editor, paraId, atomicId, trailingId } = docWithAtomicAfter({
      type: "INSERT_HORIZONTAL_LINE",
    });
    expect(getBlock(editor.state, atomicId)?.type).toBe("horizontal-line");

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(getBlock(next.state, atomicId)).toBeNull();
    expect(getBlock(next.state, paraId)?.nextSiblingId).toBe(trailingId);
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("Delete-forward at the end of the paragraph before an IMAGE deletes the image", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    // Caret to the end of "above".
    const caret = createPosition(paraId, "above".length);
    const placed = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caret, caret) },
      config,
    );

    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, config);

    expect(getBlock(next.state, atomicId)).toBeNull();
    // Caret stays at the end of "above".
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe("above".length);
  });

  it("undo restores the deleted atomic block in one step", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    const deleted = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    expect(getBlock(deleted.state, atomicId)).toBeNull();

    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    const restoredId = getBlock(undone.state, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(undone.state, restoredId)?.type).toBe("image");
  });

  it("undo restores the deleted atomic block after Delete-forward in one step", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    const caret = createPosition(paraId, "above".length);
    const placed = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caret, caret) },
      config,
    );
    const deleted = reduceEditor(placed, { type: "DELETE_FORWARD" }, config);
    expect(getBlock(deleted.state, atomicId)).toBeNull();

    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    const restoredId = getBlock(undone.state, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(undone.state, restoredId)?.type).toBe("image");
  });

  it("Backspace removes ONLY the immediate-predecessor atomic, leaving an earlier atomic intact", () => {
    // Two images in the document (each INSERT_IMAGE also adds a trailing
    // paragraph, so they are never adjacent). Chain after both inserts:
    //   above → A → trailingA → B → trailingB
    // Backspace with the caret at the start of trailingA must remove exactly
    // image A (its immediate predecessor) and leave image B untouched — proving
    // the helper deletes one block per invocation, not everything preceding.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" }, config);
    const paraId = firstChildId(editor.state) as BlockId;
    // Insert B first (after "above"), then A (after "above") so doc order is A, B.
    editor = reduceEditor(editor, { type: "INSERT_IMAGE", src: "B.png" }, config);
    const imageBId = getBlock(editor.state, paraId)?.nextSiblingId as BlockId;
    const atParaEnd = createPosition(paraId, "above".length);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(atParaEnd, atParaEnd) },
      config,
    );
    editor = reduceEditor(editor, { type: "INSERT_IMAGE", src: "A.png" }, config);
    const imageAId = getBlock(editor.state, paraId)?.nextSiblingId as BlockId;
    const trailingAId = getBlock(editor.state, imageAId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.state, imageAId)?.attrs.src).toBe("A.png");
    expect(getBlock(editor.state, imageBId)?.attrs.src).toBe("B.png");
    expect(editor.selection.focus.blockId).toBe(trailingAId);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(getBlock(next.state, imageAId)).toBeNull();
    expect(getBlock(next.state, imageBId)?.attrs.src).toBe("B.png");
    expect(getBlock(next.state, paraId)?.nextSiblingId).toBe(trailingAId);
  });

  it("regression: Backspace at the start of a normal paragraph still MERGES (no atomic neighbour)", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
    const para1Id = firstChildId(editor.state) as BlockId;
    const para2Id = getBlock(editor.state, para1Id)?.nextSiblingId as BlockId;
    // Caret at start of para2.
    const caret = createPosition(para2Id, 0);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caret, caret) },
      config,
    );

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // Merged into one paragraph "ab"; para2 gone.
    expect(getBlock(next.state, para2Id)).toBeNull();
    expect(getBlock(next.state, para1Id)?.nextSiblingId).toBeNull();
    expect(next.selection.focus.blockId).toBe(para1Id);
    expect(next.selection.focus.offset).toBe(1);
  });
});
