/**
 * Object-NAV wiring (#525 Task 8, Phase 0b). An object selection is a COLLAPSED
 * `Selection` on an atomic-leaf block (`{ blockId, 0 }`). Arrow keys / Escape on an
 * object selection move the caret OFF the object (Google Docs), leaving the object
 * intact:
 *   - ArrowLeft / ArrowUp  (MOVE_CURSOR backward / MOVE_LINE up)   → BEFORE image
 *   - ArrowRight / ArrowDown (MOVE_CURSOR forward / MOVE_LINE down) → AFTER image
 *   - Escape (ESCAPE)                                              → AFTER image
 *
 * Post-Phase-0b the arrow motions resolve through the print backend's NavIntent
 * resolver (driver layout → resolveNavIntent → reduceEditor), while ESCAPE is a
 * pure core action. Migrated from
 * `packages/core/src/editor/actions/object-nav.test.ts`; the fixture is rebuilt via
 * the public API (INSERT_IMAGE inserts a block-level image after the caret's block
 * + a fresh empty paragraph), since core test-utils don't cross the package
 * boundary. Assertions byte-identical.
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  createPosition,
  createSpan,
  isObjectSelection,
  type BlockId,
  type State,
} from "@taleweaver/core";
import {
  makeNavEditor,
  typeText,
  dispatch,
  nav,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

/** The "above" text on the leading paragraph. */
const ABOVE = "above";

interface ObjectDoc {
  readonly ctx: NavCtx;
  readonly paraId: BlockId;
  readonly imageId: BlockId;
  readonly trailingId: BlockId;
}

/**
 * Build `[para "above"] [image] [trailing empty para]` via the public API and
 * place the image under an OBJECT selection (collapsed caret at offset 0 of the
 * image). INSERT_IMAGE inserts the image after the caret's block AND a fresh empty
 * paragraph below it; the trailing empty paragraph IS that landing paragraph.
 */
function objectDoc(): ObjectDoc {
  let ctx = typeText(makeNavEditor(), ABOVE);
  const paraId = firstBlockId(ctx);
  ctx = dispatch(ctx, { type: "INSERT_IMAGE", src: "img.png" });

  const { imageId, trailingId } = locateImageAndTrailing(ctx.editor.state, paraId);

  // Select the image as an object (collapsed caret at offset 0 of the image).
  const objSel = createSpan(createPosition(imageId, 0), createPosition(imageId, 0));
  ctx = dispatch(ctx, { type: "SET_SELECTION", selection: objSel });
  expect(isObjectSelection(ctx.editor.state, ctx.editor.selection, ctx.componentRegistry)).toBe(
    imageId,
  );
  return { ctx, paraId, imageId, trailingId };
}

/** Walk the document tree to find the image (after `paraId`) and the block after it. */
function locateImageAndTrailing(
  state: State,
  paraId: BlockId,
): { imageId: BlockId; trailingId: BlockId } {
  const para = getBlock(state, paraId);
  if (para === null || para.nextSiblingId === null) {
    throw new Error("object-nav fixture: image not inserted after the leading paragraph");
  }
  const imageId = para.nextSiblingId;
  const image = getBlock(state, imageId);
  if (image === null || image.type !== "image" || image.nextSiblingId === null) {
    throw new Error("object-nav fixture: expected an image block followed by a trailing paragraph");
  }
  return { imageId, trailingId: image.nextSiblingId };
}

/** Assert the selection is a collapsed caret at `{ blockId, offset }`. */
function expectCaretAt(ctx: NavCtx, blockId: BlockId, offset: number): void {
  expect(ctx.editor.selection.focus.blockId).toBe(blockId);
  expect(ctx.editor.selection.focus.offset).toBe(offset);
  expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
}

describe("arrow / escape nav off an object selection (#525 Task 8)", () => {
  it("MOVE_CURSOR forward (ArrowRight) → caret AFTER the image; image intact", () => {
    const { ctx, imageId, trailingId } = objectDoc();
    const next = nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
    expectCaretAt(next, trailingId, 0);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });

  it("MOVE_CURSOR backward (ArrowLeft) → caret BEFORE the image (end of preceding block)", () => {
    const { ctx, paraId, imageId } = objectDoc();
    const next = nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });
    expectCaretAt(next, paraId, ABOVE.length);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });

  it("MOVE_LINE down (ArrowDown) → caret AFTER the image", () => {
    const { ctx, imageId, trailingId } = objectDoc();
    const next = nav(ctx, { type: "MOVE_LINE", direction: "down" });
    expectCaretAt(next, trailingId, 0);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });

  it("MOVE_LINE up (ArrowUp) → caret BEFORE the image", () => {
    const { ctx, paraId, imageId } = objectDoc();
    const next = nav(ctx, { type: "MOVE_LINE", direction: "up" });
    expectCaretAt(next, paraId, ABOVE.length);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });

  it("ESCAPE → caret AFTER the image (Google Docs); image intact", () => {
    const { ctx, imageId, trailingId } = objectDoc();
    const next = dispatch(ctx, { type: "ESCAPE" });
    expectCaretAt(next, trailingId, 0);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });

  it("Shift+Arrow (EXPAND_*) from an object selection does not crash; image intact", () => {
    // Range-extend OVER an atomic leaf is the crossing-range feature, which is
    // OUT of scope here. We only assert the existing extenders don't throw on an
    // object selection — they leave the image in place.
    const { ctx, imageId } = objectDoc();
    expect(() => nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" })).not.toThrow();
    expect(() => nav(ctx, { type: "EXPAND_LINE", direction: "down" })).not.toThrow();
    const afterSelect = nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" });
    const afterLine = nav(ctx, { type: "EXPAND_LINE", direction: "down" });
    expect(getBlock(afterSelect.editor.state, imageId)?.type).toBe("image");
    expect(getBlock(afterLine.editor.state, imageId)?.type).toBe("image");
  });

  it("REGRESSION: a plain text caret (not an object selection) still navigates normally", () => {
    // The object-selection guard must fire ONLY for object selections — a plain
    // caret at the start of a text block advances one grapheme on ArrowRight.
    const { ctx, paraId, imageId } = objectDoc();
    const seated = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)),
    });
    const next = nav(seated, { type: "MOVE_CURSOR", direction: "forward" });
    expectCaretAt(next, paraId, 1);
    expect(getBlock(next.editor.state, imageId)?.type).toBe("image");
  });
});
