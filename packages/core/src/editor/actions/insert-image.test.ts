/**
 * `INSERT_IMAGE` / `handleInsertImage` — Google Docs Insert ▸ Image. Inserts an
 * `image` atomic-leaf block (src + optional width/height) immediately after the
 * caret's block, followed by a fresh empty paragraph; the caret lands at the
 * start of that paragraph. Mirrors INSERT_HORIZONTAL_LINE. One undo entry.
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

describe("handleInsertImage — INSERT_IMAGE (#P11.2)", () => {
  it("inserts an image (with src + dimensions) + trailing paragraph after the caret block", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" });
    const paraId = firstChildId(editor.document) as BlockId;

    const next = reduceEditor(
      editor,
      { type: "INSERT_IMAGE", src: "https://x/i.png", width: 120, height: 80 },
    );

    const imgId = getBlock(next.document, paraId)?.nextSiblingId ?? null;
    expect(imgId).not.toBeNull();
    const img = imgId !== null ? getBlock(next.document, imgId) : null;
    expect(img?.type).toBe("image");
    expect(img?.attrs.src).toBe("https://x/i.png");
    expect(img?.attrs.width).toBe(120);
    expect(img?.attrs.height).toBe(80);

    const trailingId = img?.nextSiblingId ?? null;
    expect(getBlock(next.document, trailingId as BlockId)?.type).toBe("paragraph");
  });

  it("omits width/height attrs when not provided (so the image sizes intrinsically)", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" });
    const paraId = firstChildId(editor.document) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_IMAGE", src: "a.png" });

    const imgId = getBlock(next.document, paraId)?.nextSiblingId ?? null;
    const img = imgId !== null ? getBlock(next.document, imgId) : null;
    expect(img?.attrs.src).toBe("a.png");
    // No width/height keys → imageComponent maps to "auto" (intrinsic).
    expect(img?.attrs.width).toBeUndefined();
    expect(img?.attrs.height).toBeUndefined();
  });

  it("places the caret at the start of the new trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" });
    const paraId = firstChildId(editor.document) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_IMAGE", src: "a.png" });

    const imgId = getBlock(next.document, paraId)?.nextSiblingId ?? null;
    const trailingId = imgId !== null ? getBlock(next.document, imgId)?.nextSiblingId ?? null : null;
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("is a no-op when the caret is in a header body (not the main tree)", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_HEADER" });
    expect(getBlock(editor.document, editor.selection.focus.blockId)).toBeNull(); // caret outside main tree

    const next = reduceEditor(editor, { type: "INSERT_IMAGE", src: "a.png" });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.document).toBe(editor.document);
  });

  it("splices the image + paragraph BETWEEN the focus block and its existing next sibling", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" });
    const para1Id = firstChildId(editor.document) as BlockId;
    const para2Id = getBlock(editor.document, para1Id)?.nextSiblingId ?? null;
    expect(para2Id).not.toBeNull();

    // Move the caret back into para1, then insert the image.
    const caret = createPosition(para1Id, 1);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caret, caret) },
    );

    const next = reduceEditor(editor, { type: "INSERT_IMAGE", src: "a.png" });

    // Order: para1 → image → trailingPara → para2.
    const imgId = getBlock(next.document, para1Id)?.nextSiblingId ?? null;
    const img = imgId !== null ? getBlock(next.document, imgId) : null;
    expect(img?.type).toBe("image");
    const trailingId = img?.nextSiblingId ?? null;
    const trailing = trailingId !== null ? getBlock(next.document, trailingId) : null;
    expect(trailing?.type).toBe("paragraph");
    expect(trailing?.nextSiblingId).toBe(para2Id);

    // Caret lands in the trailing paragraph.
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("undo removes the image and the trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "y" });
    const paraId = firstChildId(editor.document) as BlockId;
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBeNull();

    const inserted = reduceEditor(editor, { type: "INSERT_IMAGE", src: "a.png" });
    expect(getBlock(inserted.document, paraId)?.nextSiblingId).not.toBeNull();

    const undone = reduceEditor(inserted, { type: "UNDO" });
    expect(getBlock(undone.document, paraId)?.nextSiblingId).toBeNull();
  });
});
