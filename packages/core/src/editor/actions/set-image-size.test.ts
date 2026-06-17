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
  createInitialEditorState,
  reduceEditor,
  firstChildId,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

/** Insert an image (120×80) after the first paragraph; return its block id. */
function docWithImage() {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
  const paraId = firstChildId(editor.state) as BlockId;
  editor = reduceEditor(
    editor,
    { type: "INSERT_IMAGE", src: "i.png", width: 120, height: 80 },
    config,
  );
  const imageId = getBlock(editor.state, paraId)?.nextSiblingId as BlockId;
  // Self-validate the fixture: if INSERT_IMAGE ever stops placing the image as
  // the paragraph's next sibling, imageId would be null and the no-op tests
  // would pass vacuously. Pin it down here so a placement regression fails loud.
  expect(getBlock(editor.state, imageId)?.type).toBe("image");
  return { editor, paraId, imageId };
}

describe("handleSetImageSize — SET_IMAGE_SIZE (#P11.4)", () => {
  it("merges width/height onto the target image block", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 },
      config,
    );

    const img = getBlock(next.state, imageId);
    expect(img?.attrs.width).toBe(200);
    expect(img?.attrs.height).toBe(100);
    // src preserved (merge, not replace).
    expect(img?.attrs.src).toBe("i.png");
  });

  it("leaves the selection unchanged (resize is a geometry edit, not a caret move)", () => {
    const { editor, imageId } = docWithImage();
    const before = editor.selection;

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 },
      config,
    );

    expect(next.selection).toEqual(before);
  });

  it("is a no-op when the target is not an image block", () => {
    const { editor, paraId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: paraId, width: 200, height: 100 },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("is a no-op when the target block does not exist", () => {
    const { editor } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: "missing-id" as BlockId, width: 50, height: 50 },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("is a no-op when width/height are unchanged", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: imageId, width: 120, height: 80 },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("rejects non-positive / non-finite dimensions (no-op)", () => {
    const { editor, imageId } = docWithImage();

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(
      reduceEditor(editor, { type: "SET_IMAGE_SIZE", blockId: imageId, width: 0, height: 100 }, config).state,
    ).toBe(editor.state);
    expect(
      reduceEditor(editor, { type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: -5 }, config).state,
    ).toBe(editor.state);
    expect(
      reduceEditor(
        editor,
        { type: "SET_IMAGE_SIZE", blockId: imageId, width: Number.NaN, height: 100 },
        config,
      ).state,
    ).toBe(editor.state);
    expect(
      reduceEditor(
        editor,
        { type: "SET_IMAGE_SIZE", blockId: imageId, width: Number.POSITIVE_INFINITY, height: 100 },
        config,
      ).state,
    ).toBe(editor.state);
    expect(
      reduceEditor(
        editor,
        { type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: Number.NEGATIVE_INFINITY },
        config,
      ).state,
    ).toBe(editor.state);
  });

  it("undo restores the previous size in one step", () => {
    const { editor, imageId } = docWithImage();
    const resized = reduceEditor(
      editor,
      { type: "SET_IMAGE_SIZE", blockId: imageId, width: 200, height: 100 },
      config,
    );
    expect(getBlock(resized.state, imageId)?.attrs.width).toBe(200);

    const undone = reduceEditor(resized, { type: "UNDO" }, config);
    expect(getBlock(undone.state, imageId)?.attrs.width).toBe(120);
    expect(getBlock(undone.state, imageId)?.attrs.height).toBe(80);
  });
});
