/**
 * `SET_IMAGE_ALT` / `handleSetImageAlt` — the engine half of accessible-image alt
 * text. Sets the accessible name (`alt`) on an existing `image` block's attrs; the
 * a11y projection (`build-accessibility-tree.ts` `imageAlt`) reads it. Targets an
 * explicit `blockId` (an atomic image holds no cursor positions, so it can never
 * be the selection focus).
 *
 * `alt` has THREE distinct, all-meaningful states (HTML/ARIA convention), UNLIKE
 * `SET_IMAGE_WRAP` where the default is stored as absence:
 *   - absent          → unlabeled image (AT announces "image"/filename).
 *   - `""` (empty)    → explicitly DECORATIVE (AT skips it). PRESERVED as a set
 *                       value, NOT collapsed to absence.
 *   - non-empty       → labeled.
 * So `alt: string` (INCLUDING `""`) sets the attr; `alt: null` clears it.
 * Selection is unchanged; one undo entry.
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
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" });
  const paraId = firstChildId(editor.document) as BlockId;
  editor = reduceEditor(
    editor,
    { type: "INSERT_IMAGE", src: "i.png", width: 120, height: 80 },
  );
  const imageId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
  // Self-validate the fixture: if INSERT_IMAGE ever stops placing the image as
  // the paragraph's next sibling, imageId would be null and the no-op tests
  // would pass vacuously. Pin it down here so a placement regression fails loud.
  expect(getBlock(editor.document, imageId)?.type).toBe("image");
  return { editor, paraId, imageId };
}

describe("handleSetImageAlt — SET_IMAGE_ALT (accessible image name)", () => {
  it("sets a non-empty alt onto the target image block", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "A red barn" },
    );

    const img = getBlock(next.document, imageId);
    expect(img?.attrs.alt).toBe("A red barn");
    // src preserved (merge, not replace).
    expect(img?.attrs.src).toBe("i.png");
  });

  it("sets alt='' (DECORATIVE) and PRESERVES it (the key exists, not absence)", () => {
    const { editor, imageId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "" },
    );

    const img = getBlock(next.document, imageId);
    expect(img?.attrs.alt).toBe("");
    expect("alt" in (img?.attrs ?? {})).toBe(true);
  });

  it("alt=null CLEARS the alt key (back to absent/unlabeled)", () => {
    const { editor, imageId } = docWithImage();

    // First label it so there's something to clear.
    const labeled = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "Cat" },
    );
    expect(getBlock(labeled.document, imageId)?.attrs.alt).toBe("Cat");

    const cleared = reduceEditor(
      labeled,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: null },
    );

    const img = getBlock(cleared.document, imageId);
    expect(img?.attrs.alt).toBeUndefined();
    expect("alt" in (img?.attrs ?? {})).toBe(false);
  });

  it("leaves the selection unchanged (alt is a metadata edit, not a caret move)", () => {
    const { editor, imageId } = docWithImage();
    const before = editor.selection;

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "A red barn" },
    );

    expect(next.selection).toEqual(before);
  });

  it("is a no-op when the target is not an image block", () => {
    const { editor, paraId } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: paraId, alt: "A red barn" },
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.document).toBe(editor.document);
  });

  it("is a no-op when the target block does not exist", () => {
    const { editor } = docWithImage();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: "missing-id" as BlockId, alt: "x" },
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.document).toBe(editor.document);
  });

  it("is a no-op when alt is unchanged (already that value)", () => {
    const { editor, imageId } = docWithImage();
    const labeled = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "Cat" },
    );

    const again = reduceEditor(
      labeled,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "Cat" },
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(again.document).toBe(labeled.document);
  });

  it("is a no-op when clearing (null) an already-unlabeled image", () => {
    const { editor, imageId } = docWithImage();
    // The freshly-inserted image carries no alt key, so null is identity.
    expect(getBlock(editor.document, imageId)?.attrs.alt).toBeUndefined();

    const next = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: null },
    );

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.document).toBe(editor.document);
  });

  it("undo restores the previous alt in one step (Cat → null, then undo → Cat)", () => {
    const { editor, imageId } = docWithImage();
    const labeled = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "Cat" },
    );
    const cleared = reduceEditor(
      labeled,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: null },
    );
    expect(getBlock(cleared.document, imageId)?.attrs.alt).toBeUndefined();

    const undone = reduceEditor(cleared, { type: "UNDO" });
    expect(getBlock(undone.document, imageId)?.attrs.alt).toBe("Cat");
  });

  it("undo restores ABSENT alt (no key) in one step ((no alt) → Cat, then undo → absent)", () => {
    const { editor, imageId } = docWithImage();
    const labeled = reduceEditor(
      editor,
      { type: "SET_IMAGE_ALT", blockId: imageId, alt: "Cat" },
    );
    expect(getBlock(labeled.document, imageId)?.attrs.alt).toBe("Cat");

    const undone = reduceEditor(labeled, { type: "UNDO" });
    const img = getBlock(undone.document, imageId);
    expect(img?.attrs.alt).toBeUndefined();
    expect("alt" in (img?.attrs ?? {})).toBe(false);
  });
});
