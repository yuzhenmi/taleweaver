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

describe("handleSetImageWrap — SET_IMAGE_WRAP (image text-wrap)", () => {
  it("sets wrap='left' onto the target image block", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );

    const img = getBlock(next.state, imageId);
    expect(img?.attrs.wrap).toBe("left");
    // src preserved (merge, not replace).
    expect(img?.attrs.src).toBe("i.png");
  });

  it("wrap='break' CLEARS the wrap key (break == never-wrapped, byte-identical)", () => {
    const { editor, imageId } = docWithImage();

    // First set a wrap so there's something to clear.
    const wrapped = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "right" },
      config,
    );
    expect(getBlock(wrapped.state, imageId)?.attrs.wrap).toBe("right");

    const cleared = reduceEditor(
      wrapped,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" },
      config,
    );

    const img = getBlock(cleared.state, imageId);
    expect(img?.attrs.wrap).toBeUndefined();
    expect("wrap" in (img?.attrs ?? {})).toBe(false);
  });

  it("leaves the selection unchanged (wrap is a geometry edit, not a caret move)", () => {
    const { editor, imageId } = docWithImage();
    const before = editor.selection;

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );

    expect(next.selection).toEqual(before);
  });

  it("is a no-op when the target is not an image block", () => {
    const { editor, paraId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: paraId, wrap: "left" },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("is a no-op when the target block does not exist", () => {
    const { editor } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: "missing-id" as BlockId, wrap: "left" },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("is a no-op for an invalid wrap value", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      // Force an out-of-range value past the type to exercise the runtime guard.
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "center" as unknown as "left" },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("is a no-op when wrap is unchanged (already that value)", () => {
    const { editor, imageId } = docWithImage();
    const wrapped = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );

    const again = reduceEditor(
      wrapped,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(again.state).toBe(wrapped.state);
  });

  it("is a no-op when clearing (break) an already-un-wrapped image", () => {
    const { editor, imageId } = docWithImage();
    // The freshly-inserted image carries no wrap key, so break is identity.
    expect(getBlock(editor.state, imageId)?.attrs.wrap).toBeUndefined();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" },
      config,
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("undo restores the previous wrap in one step (left → break, then undo → left)", () => {
    const { editor, imageId } = docWithImage();
    const wrapped = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );
    const cleared = reduceEditor(
      wrapped,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "break" },
      config,
    );
    expect(getBlock(cleared.state, imageId)?.attrs.wrap).toBeUndefined();

    const undone = reduceEditor(cleared, { type: "UNDO" }, config);
    expect(getBlock(undone.state, imageId)?.attrs.wrap).toBe("left");
  });

  it("undo restores ABSENT wrap (no key) in one step ((no wrap) → left, then undo → absent)", () => {
    const { editor, imageId } = docWithImage();
    const wrapped = reduceEditor(
      editor,
      { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" },
      config,
    );
    expect(getBlock(wrapped.state, imageId)?.attrs.wrap).toBe("left");

    const undone = reduceEditor(wrapped, { type: "UNDO" }, config);
    const img = getBlock(undone.state, imageId);
    expect(img?.attrs.wrap).toBeUndefined();
    expect("wrap" in (img?.attrs ?? {})).toBe(false);
  });
});
