/**
 * `SET_IMAGE_WRAP` / `handleSetImageWrap` — the engine half of image text-wrap.
 * Sets the Google-Docs text-wrap mode (`"left" | "right" | "break"`) on an
 * existing `image` block's attrs; `imageComponent` reads it (`imageWrapFloat`).
 * Targets an explicit `blockId` (an atomic image holds no cursor positions, so it
 * can never be the selection focus). `"break"` is the default and is stored as
 * ABSENCE (clears the `wrap` key). Selection is unchanged; one undo entry.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createEditor, firstChildId } from "./test-helpers";
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

describe("handleSetImageWrap — SET_IMAGE_WRAP (image text-wrap)", () => {
  it("sets wrap='left' onto the target image block", () => {
    const { editor, imageId } = docWithImage();

    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });

    const img = getBlock(editor.document, imageId);
    expect(img?.attrs.wrap).toBe("left");
    // src preserved (merge, not replace).
    expect(img?.attrs.src).toBe("i.png");
  });

  it("wrap='break' CLEARS the wrap key (break == never-wrapped, byte-identical)", () => {
    const { editor, imageId } = docWithImage();

    // First set a wrap so there's something to clear.
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "right" });
    expect(getBlock(editor.document, imageId)?.attrs.wrap).toBe("right");

    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" });

    const img = getBlock(editor.document, imageId);
    expect(img?.attrs.wrap).toBeUndefined();
    expect("wrap" in (img?.attrs ?? {})).toBe(false);
  });

  it("leaves the selection unchanged (wrap is a geometry edit, not a caret move)", () => {
    const { editor, imageId } = docWithImage();
    const before = editor.selection;

    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });

    expect(editor.selection).toEqual(before);
  });

  it("is a no-op when the target is not an image block", () => {
    const { editor, paraId } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: paraId, wrap: "left" });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op when the target block does not exist", () => {
    const { editor } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: "missing-id" as BlockId, wrap: "left" });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op for an invalid wrap value", () => {
    const { editor, imageId } = docWithImage();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "center" as unknown as "left" });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op when wrap is unchanged (already that value)", () => {
    const { editor, imageId } = docWithImage();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("is a no-op when clearing (break) an already-un-wrapped image", () => {
    const { editor, imageId } = docWithImage();
    // The freshly-inserted image carries no wrap key, so break is identity.
    expect(getBlock(editor.document, imageId)?.attrs.wrap).toBeUndefined();

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" });

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("undo restores the previous wrap in one step (left → break, then undo → left)", () => {
    const { editor, imageId } = docWithImage();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" });
    expect(getBlock(editor.document, imageId)?.attrs.wrap).toBeUndefined();

    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, imageId)?.attrs.wrap).toBe("left");
  });

  it("undo restores ABSENT wrap (no key) in one step ((no wrap) → left, then undo → absent)", () => {
    const { editor, imageId } = docWithImage();
    editor.dispatch({ type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });
    expect(getBlock(editor.document, imageId)?.attrs.wrap).toBe("left");

    editor.dispatch({ type: "UNDO" });
    const img = getBlock(editor.document, imageId);
    expect(img?.attrs.wrap).toBeUndefined();
    expect("wrap" in (img?.attrs ?? {})).toBe(false);
  });
});
