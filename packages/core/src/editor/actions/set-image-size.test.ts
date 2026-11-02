/**
 * `SET_IMAGE_SIZE` / `handleSetImageSize` (#P11.4) — the engine half of image
 * resize. Merges `width`/`height` onto an existing `image` block's attrs,
 * targeting an explicit `blockId` (the resize-handle interaction, browser-gated,
 * supplies it — an atomic image holds no cursor positions, so it can never be
 * the selection focus). Selection is unchanged; one undo entry.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createEditor,
  firstChildId,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

/** Insert an image (120×80) after the first paragraph; return its block id. */
function docWithImage() {
  let editor = createEditor(config);
  editor.dispatch({ type: "INSERT_TEXT", text: "x" });
  const paraId = firstChildId(editor.document) as BlockId;
  editor.dispatch({ type: "INSERT_IMAGE", src: "i.png", width: 120, height: 80 });
  const imageId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
  // Self-validate the fixture: if INSERT_IMAGE ever stops placing the image as
  // the paragraph's next sibling, imageId would be null and the no-op tests
  // would pass vacuously. Pin it down here so a placement regression fails loud.
  expect(getBlock(editor.document, imageId)?.type).toBe("image");
  return { editor, paraId, imageId };
}

describe("handleSetImageSize — SET_IMAGE_SIZE (#P11.4)", () => {
  it("merges width/height onto the target image block", () => {
    const { editor, imageId } = docWithImage();

    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 });

    const img = getBlock(editor.document, imageId);
    expect(img?.attrs.width).toBe(200);
    expect(img?.attrs.height).toBe(100);
    // src preserved (merge, not replace).
    expect(img?.attrs.src).toBe("i.png");
  });

  it("leaves the selection unchanged (resize is a geometry edit, not a caret move)", () => {
    const { editor, imageId } = docWithImage();
    const before = editor.selection;

    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 });

    expect(editor.selection).toEqual(before);
  });

  it("is a no-op when the target is not an image block", () => {
    const { editor, paraId } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: paraId, width: 200, height: 100 });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op when the target block does not exist", () => {
    const { editor } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: "missing-id" as BlockId, width: 50, height: 50 });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op when width/height are unchanged", () => {
    const { editor, imageId } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: imageId, width: 120, height: 80 });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("rejects non-positive / non-finite dimensions (no-op)", () => {
    const { editor, imageId } = docWithImage();

    const before = editor.snapshot();
    const invalid: [number, number][] = [
      [0, 100],
      [200, -5],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
      [200, Number.NEGATIVE_INFINITY],
    ];
    for (const [width, height] of invalid) {
      editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: imageId, width, height });
      // Nothing written (no-op; reducer entry-clears lastDirtyIds).
      expect(editor.document).toBe(before.document);
    }
  });

  it("undo restores the previous size in one step", () => {
    const { editor, imageId } = docWithImage();
    editor.dispatch({ type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 });
    expect(getBlock(editor.document, imageId)?.attrs.width).toBe(200);

    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, imageId)?.attrs.width).toBe(120);
    expect(getBlock(editor.document, imageId)?.attrs.height).toBe(80);
  });
});
