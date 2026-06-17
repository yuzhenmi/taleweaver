/**
 * Arrow-nav (MOVE_CURSOR) across a FLOATED atomic image — the caret-crossing
 * half of the image-wrap behavior lock. An `image` is an ATOMIC-LEAF block
 * (`inlineContent === null`): it holds no cursor positions of its own, so nav
 * steps ACROSS it between the two surrounding text positions, never landing a
 * caret inside it. Floating (wrap:left) does not change that contract.
 *
 * Phase 0b: MOVE_CURSOR left core's geometry-free reducer for the print
 * backend's `resolveNavIntent`. These tests therefore drive the keystroke
 * through the nav helper (driver layout → resolveNavIntent → reduceEditor)
 * end-to-end. The wrap/layout-GEOMETRY assertions (float box rect, narrowed
 * lines, hit-test, selection rects) stay in core's `image-wrap-behavior.test.ts`,
 * built via the driver's render→cascade→layout recipe. Migrated from there;
 * assertions byte-identical.
 *
 * Fixture `[paragraph "PRE", image{wrap:left}, paragraph LONG]` is built through
 * the PUBLIC editor API (core test-utils don't cross the package boundary):
 * INSERT_IMAGE splices the image AFTER the "PRE" caret block plus a fresh
 * trailing paragraph; LONG_TEXT is then typed into that trailing paragraph and
 * the image's wrap set to "left".
 */
import { describe, it, expect } from "vitest";
import { getBlock, createPosition, createSpan, type BlockId } from "@taleweaver/core";
import {
  makeNavEditor,
  typeText,
  dispatch,
  setSelection,
  nav,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

// ~18 words → wraps to several lines at the container width, so the float-narrowed
// first lines exist (the geometry the core test asserts; here it only has to be a
// real wrapped paragraph for the cross-the-float nav to be meaningful).
const LONG_TEXT =
  "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";

/**
 * Build `[paragraph "PRE", image{wrap:left}, paragraph LONG]` and locate the
 * image + the trailing (LONG) paragraph. The caret ends inside the LONG
 * paragraph (where the typed text landed).
 */
function predecessorDoc(): { ctx: NavCtx; preId: BlockId; imageId: BlockId; paraId: BlockId } {
  let ctx = typeText(makeNavEditor({ containerWidth: 500 }), "PRE");
  const preId = firstBlockId(ctx);
  ctx = dispatch(ctx, { type: "INSERT_IMAGE", src: "i.png", width: 100, height: 32 });

  const pre = getBlock(ctx.editor.state, preId);
  if (pre === null || pre.nextSiblingId === null) {
    throw new Error("image-wrap-nav fixture: image not inserted after PRE");
  }
  const imageId = pre.nextSiblingId;
  const image = getBlock(ctx.editor.state, imageId);
  if (image === null || image.type !== "image" || image.nextSiblingId === null) {
    throw new Error("image-wrap-nav fixture: expected an image followed by a trailing paragraph");
  }
  const paraId = image.nextSiblingId;

  // Float the image (wrap:left), then fill the trailing paragraph with LONG_TEXT.
  ctx = dispatch(ctx, { type: "SET_IMAGE_WRAP", blockId: imageId, wrap: "left" });
  ctx = setSelection(ctx, createSpan(createPosition(paraId, 0), createPosition(paraId, 0)));
  ctx = typeText(ctx, LONG_TEXT);
  return { ctx, preId, imageId, paraId };
}

const right = (ctx: NavCtx): NavCtx => nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
const left = (ctx: NavCtx): NavCtx => nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });

describe("image-wrap behavior — caret positions & arrow-nav across the floated image", () => {
  it("ArrowRight from the end of the text BEFORE the float crosses to the start of the wrapped paragraph (does not jump past it)", () => {
    const { ctx: doc, preId, paraId } = predecessorDoc();
    // Caret to the end of "PRE".
    const start = createPosition(preId, "PRE".length);
    let ctx = setSelection(doc, createSpan(start, start));

    ctx = right(ctx);
    // The atomic image holds no caret position of its own; nav steps ACROSS it to
    // the next reachable text position — the wrapped paragraph's start (offset 0).
    // (NOT a skip-past: the very next position in document order, on the far side
    // of the float.) The subsequent ArrowRight then advances WITHIN the paragraph,
    // proving the caret actually entered it rather than overshooting.
    expect(ctx.editor.selection.focus).toEqual(createPosition(paraId, 0));
    ctx = right(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(paraId, 1));
  });

  it("ArrowLeft from the start of the wrapped paragraph crosses back over the float to the preceding text", () => {
    const { ctx: doc, preId, paraId } = predecessorDoc();
    let ctx = setSelection(doc, createSpan(createPosition(paraId, 0), createPosition(paraId, 0)));

    ctx = left(ctx);
    // Symmetric: crosses the float back to the end of the preceding paragraph.
    expect(ctx.editor.selection.focus).toEqual(createPosition(preId, "PRE".length));
  });

  it("PRE-EXISTING ATOMIC-LEAF BOUNDARY: the image holds NO caret position of its own (nav never lands inside it)", () => {
    // The image is an atomic leaf (inlineContent === null) — it has no internal
    // offsets. Crossing it (above) never produces a `{blockId:"img"}` focus; the
    // caret only ever rests on a surrounding TEXT block. This is the documented
    // contract (actions/atomic-delete.test.ts), unrelated to floating.
    const { ctx: doc, preId, imageId } = predecessorDoc();
    const start = createPosition(preId, "PRE".length);
    let ctx = setSelection(doc, createSpan(start, start));
    ctx = right(ctx);
    expect(ctx.editor.selection.focus.blockId).not.toBe(imageId);
  });
});
