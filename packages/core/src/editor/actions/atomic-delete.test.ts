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
  createEditor, firstChildId, createPosition, createSpan } from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

/** Build `[para "above"] [atomic] [empty trailing para]`, caret at trailing-para start. */
function docWithAtomicAfter(
  insert: { type: "INSERT_IMAGE"; src: string } | { type: "INSERT_HORIZONTAL_LINE" },
) {
  let editor = createEditor(config);
  editor.dispatch({ type: "INSERT_TEXT", text: "above" });
  const paraId = firstChildId(editor.document) as BlockId;
  editor.dispatch(insert);
  const atomicId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
  const trailingId = getBlock(editor.document, atomicId)?.nextSiblingId as BlockId;
  return { editor, paraId, atomicId, trailingId };
}

describe("atomic-leaf delete behavior (#P11.3)", () => {
  it("Backspace at the start of the paragraph after an IMAGE deletes the image", () => {
    const { editor, paraId, atomicId, trailingId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    expect(getBlock(editor.document, atomicId)?.type).toBe("image");
    // INSERT_IMAGE leaves the caret at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);

    editor.dispatch({ type: "DELETE_BACKWARD" });

    // Image removed; the paragraph chain closes up around it.
    expect(getBlock(editor.document, atomicId)).toBeNull();
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBe(trailingId);
    expect(getBlock(editor.document, trailingId)?.prevSiblingId).toBe(paraId);
    // Caret stays at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });

  it("Backspace at the start of the paragraph after a HORIZONTAL-LINE deletes the rule", () => {
    const { editor, paraId, atomicId, trailingId } = docWithAtomicAfter({
      type: "INSERT_HORIZONTAL_LINE",
    });
    expect(getBlock(editor.document, atomicId)?.type).toBe("horizontal-line");

    editor.dispatch({ type: "DELETE_BACKWARD" });

    expect(getBlock(editor.document, atomicId)).toBeNull();
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBe(trailingId);
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("Delete-forward at the end of the paragraph before an IMAGE deletes the image", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    // Caret to the end of "above".
    const caret = createPosition(paraId, "above".length);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });

    editor.dispatch({ type: "DELETE_FORWARD" });

    expect(getBlock(editor.document, atomicId)).toBeNull();
    // Caret stays at the end of "above".
    expect(editor.selection.focus.blockId).toBe(paraId);
    expect(editor.selection.focus.offset).toBe("above".length);
  });

  it("undo restores the deleted atomic block in one step", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(getBlock(editor.document, atomicId)).toBeNull();

    editor.dispatch({ type: "UNDO" });
    const restoredId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.document, restoredId)?.type).toBe("image");
  });

  it("undo restores the deleted atomic block after Delete-forward in one step", () => {
    const { editor, paraId, atomicId } = docWithAtomicAfter({
      type: "INSERT_IMAGE",
      src: "img.png",
    });
    const caret = createPosition(paraId, "above".length);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(editor.document, atomicId)).toBeNull();

    editor.dispatch({ type: "UNDO" });
    const restoredId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.document, restoredId)?.type).toBe("image");
  });

  it("Backspace removes ONLY the immediate-predecessor atomic, leaving an earlier atomic intact", () => {
    // Two images in the document (each INSERT_IMAGE also adds a trailing
    // paragraph, so they are never adjacent). Chain after both inserts:
    //   above → A → trailingA → B → trailingB
    // Backspace with the caret at the start of trailingA must remove exactly
    // image A (its immediate predecessor) and leave image B untouched — proving
    // the helper deletes one block per invocation, not everything preceding.
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "above" });
    const paraId = firstChildId(editor.document) as BlockId;
    // Insert B first (after "above"), then A (after "above") so doc order is A, B.
    editor.dispatch({ type: "INSERT_IMAGE", src: "B.png" });
    const imageBId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    const atParaEnd = createPosition(paraId, "above".length);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(atParaEnd, atParaEnd) });
    editor.dispatch({ type: "INSERT_IMAGE", src: "A.png" });
    const imageAId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    const trailingAId = getBlock(editor.document, imageAId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.document, imageAId)?.attrs.src).toBe("A.png");
    expect(getBlock(editor.document, imageBId)?.attrs.src).toBe("B.png");
    expect(editor.selection.focus.blockId).toBe(trailingAId);

    editor.dispatch({ type: "DELETE_BACKWARD" });

    expect(getBlock(editor.document, imageAId)).toBeNull();
    expect(getBlock(editor.document, imageBId)?.attrs.src).toBe("B.png");
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBe(trailingAId);
  });

  it("regression: Backspace at the start of a normal paragraph still MERGES (no atomic neighbour)", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "a" });
    editor.dispatch({ type: "SPLIT_NODE" });
    editor.dispatch({ type: "INSERT_TEXT", text: "b" });
    const para1Id = firstChildId(editor.document) as BlockId;
    const para2Id = getBlock(editor.document, para1Id)?.nextSiblingId as BlockId;
    // Caret at start of para2.
    const caret = createPosition(para2Id, 0);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });

    editor.dispatch({ type: "DELETE_BACKWARD" });

    // Merged into one paragraph "ab": ¶para1 goes and para2 survives.
    expect(getBlock(editor.document, para1Id)).toBeNull();
    expect(getBlock(editor.document, para2Id)?.prevSiblingId).toBeNull();
    expect(editor.selection.focus.blockId).toBe(para2Id);
    expect(editor.selection.focus.offset).toBe(1);
  });
});
