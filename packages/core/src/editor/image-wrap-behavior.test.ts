/**
 * Behavior-regression lock: caret / hit-test / selection around a FLOATED image
 * (image text-wrap, Task 5). The spec's named load-bearing risk is that there is
 * zero existing coverage for editor interaction around a float — this file closes
 * that gap by driving the REAL editor (`createEditorStateFromState` →
 * `reduceEditor`) end-to-end (render → cascade → layout → cursor/hit-test/
 * selection), NOT internal units.
 *
 * Document under test: `[image{wrap:"left"}, paragraph{long text}]` — an `image`
 * block whose `wrap` attr maps (via `imageWrapFloat`) to a logical `float`, laid
 * out as a CSS-9.5 float; the SIBLING paragraph's IFC narrows its first lines
 * around the float (the topology proven in `integration/image-wrap.test.ts`).
 *
 * Geometry (mock shaper charWidth=8, lineHeight=16; CONTAINER_W=500, W=100, H=32
 * = two line-heights) — mirrors the float-layout test's arithmetic:
 *   - float image: physical x=0, y=0, inlineSize=W=100, blockSize=H=32.
 *   - paragraph lines OVERLAPPING the float (y=0, y=16): absoluteX = W = 100,
 *     inlineSize = CONTAINER_W − W = 400 (pushed right by the float).
 *   - paragraph lines AT/BELOW the float bottom (y >= H = 32): absoluteX = 0,
 *     inlineSize = CONTAINER_W = 500 (full width).
 *
 * ── TWO PRE-EXISTING ARCHITECTURAL BOUNDARIES (NOT defects of image-wrap) ──
 * An `image` is an ATOMIC-LEAF block (`inlineContent === null`): it holds no
 * cursor positions of its own and produces NO `LineBox`. Two consequences,
 * BOTH independent of floating (proven by the no-float control test below):
 *   (1) ARROW-NAV crosses the image between the two surrounding text positions —
 *       it never lands a caret *inside* the image (there is none to land on).
 *       This is the documented atomic-leaf nav contract (see
 *       `actions/atomic-delete.test.ts`).
 *   (2) HIT-TEST is LINE-based; with no line, a click on the image's painted
 *       rect resolves to the nearest paragraph line, NOT the image block. An
 *       image can never be a `Selection` focus (see `set-image-size.ts` /
 *       `set-image-wrap.ts` docstrings), so "click selects the image as an
 *       object" is unbuilt object-selection, out of scope here. The control test
 *       shows a NON-floated full-width image behaves identically — floating does
 *       not introduce or worsen this; it is a deliberate v1 boundary.
 * These are characterized explicitly (asserted, with a comment naming them) so a
 * future object-selection feature has a tripwire, rather than being silently
 * untested.
 */
import { describe, it, expect } from "vitest";
import {
  createEditorStateFromState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "./editor-state";
import { createMockShaper } from "../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { render } from "../render/render";
import { cascadePass } from "../cascade/cascade-pass";
import { layoutTree } from "@taleweaver/print";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import { createPosition, createSpan, getBlock } from "../state";
import type { BlockId, Selection } from "../state";
import type { LayoutBox } from "@taleweaver/print";
import { getLineIndex } from "@taleweaver/print";
import { resolvePixelPosition } from "@taleweaver/print";
import { resolveHitPosition } from "@taleweaver/print";
import { computeSelectionRects } from "@taleweaver/print";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const CHAR_W = 8;
const LINE_H = 16;
const CONTAINER_W = 500;
const W = 100; // image inline-size (float width) — a clean 1/5 of CONTAINER_W.
const H = 32; // image block-size (float height) = two line-heights.

// Phase 0b: `measurer` left core's `EditorConfig` for the print backend's
// layout driver. These geometry assertions build the layout tree directly via
// core's pipeline (render → cascade → layout — what the driver does); the
// MOVE_CURSOR arrow-nav assertions moved to the backend nav suite
// (packages/print/src/nav/image-wrap-nav.test.ts).
const measurer = createMockShaper(CHAR_W, LINE_H);

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: CONTAINER_W,
  };
}

/** Build the layout tree the backend driver would (render → cascade → layout). */
function layoutOf(editor: EditorState, config: EditorConfig): LayoutBox {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const tree = layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
  if (tree.type === "virtual-root") {
    throw new Error("expected a non-paginated LayoutBox tree");
  }
  return tree;
}

// ~18 words × 5 chars (+ space) → wraps to several lines at both the narrowed
// 400px width and the full 500px width, so we get lines both overlapping and
// below the float region.
const LONG_TEXT =
  "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";

const para = (offset: number) => createPosition("para" as BlockId, offset);

/**
 * Seed `[image, paragraph]` directly (so the image PRECEDES the paragraph it
 * narrows — INSERT_IMAGE always splices an image AFTER the caret block, which
 * cannot produce this topology). `wrap` and `direction` are applied to the image
 * block (the image's OWN direction governs `imageWrapFloat`) and `direction` to
 * the paragraph (governs its IFC reorder).
 */
function seed(wrap?: string, direction?: string) {
  const imgAttrs: Record<string, unknown> = { src: "i.png", width: W, height: H };
  if (wrap !== undefined) imgAttrs.wrap = wrap;
  if (direction !== undefined) imgAttrs.direction = direction;
  const paraAttrs: Record<string, unknown> = { whiteSpace: "normal" };
  if (direction !== undefined) paraAttrs.direction = direction;
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "para" }),
      buildBlock({
        id: "img",
        type: "image",
        parentId: "doc",
        nextSiblingId: "para",
        attrs: imgAttrs,
        inlineContent: null,
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "img",
        attrs: paraAttrs,
        inlineContent: inlineContent([text(LONG_TEXT)]),
      }),
    ],
  });
}

/**
 * Seed `[paragraph "PRE", image, paragraph LONG]` — a text block BEFORE the
 * image so arrow-nav has a position to cross to/from on the image's leading
 * side (the image-first seed has no such position; doc-start is the para).
 */
function seedWithPredecessor(wrap = "left") {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "pre", lastChildId: "para" }),
      buildBlock({
        id: "pre",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "img",
        attrs: { whiteSpace: "normal" },
        inlineContent: inlineContent([text("PRE")]),
      }),
      buildBlock({
        id: "img",
        type: "image",
        parentId: "doc",
        prevSiblingId: "pre",
        nextSiblingId: "para",
        attrs: { src: "i.png", width: W, height: H, wrap },
        inlineContent: null,
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "img",
        attrs: { whiteSpace: "normal" },
        inlineContent: inlineContent([text(LONG_TEXT)]),
      }),
    ],
  });
}

function editorFrom(state: ReturnType<typeof seed>, sel: Selection): EditorState {
  return createEditorStateFromState(state, sel, makeConfig());
}

/** The editor's (non-paginated) plain LayoutBox tree, built via the driver recipe. */
function plainTree(editor: EditorState): LayoutBox {
  return layoutOf(editor, makeConfig());
}

/** Find the box for `key` in the layout subtree. */
function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r !== null) return r;
    }
  }
  return null;
}

interface AbsLine {
  y: number;
  x: number;
  inlineSize: number;
}

function paraLines(tree: LayoutBox, blockId = "para"): AbsLine[] {
  const lines = getLineIndex(tree).byBlock.get(blockId as BlockId) ?? [];
  return lines.map((l) => ({ y: l.absoluteY, x: l.absoluteX, inlineSize: l.line.inlineSize }));
}

describe("image-wrap behavior — float geometry (the load-bearing layout claim, through the editor)", () => {
  it("the floated image box reports its real painted rect (x=0, y=0, W×H)", () => {
    const editor = editorFrom(seed("left"), createSpan(para(0), para(0)));
    const imgBox = findBoxByKey(plainTree(editor), "img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) return;
    // Inline-start edge under LTR → physical x=0; the Task-4 float-box fix gives
    // it a real (non-degenerate) painted/hit-test rect: explicit W×H.
    expect(imgBox.x).toBe(0);
    expect(imgBox.y).toBe(0);
    expect(imgBox.inlineSize).toBe(W);
    expect(imgBox.blockSize).toBe(H);
  });

  it("the wrapped paragraph narrows around the float (overlapping lines inset by W, below-lines full-width)", () => {
    const editor = editorFrom(seed("left"), createSpan(para(0), para(0)));
    const lines = paraLines(plainTree(editor));
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const overlapping = lines.filter((l) => l.y < H);
    const below = lines.filter((l) => l.y >= H);
    expect(overlapping.length).toBeGreaterThanOrEqual(2);
    expect(below.length).toBeGreaterThanOrEqual(1);

    for (const l of overlapping) {
      expect(l.x).toBe(W); // inset by the float width
      expect(l.inlineSize).toBe(CONTAINER_W - W); // 400
    }
    expect(overlapping.map((l) => l.y).sort((a, b) => a - b)).toEqual([0, 16]);
    for (const l of below) {
      expect(l.x).toBe(0);
      expect(l.inlineSize).toBe(CONTAINER_W); // 500 — back to full width
    }
    expect(below[0]?.y).toBe(H); // first below-line sits exactly at the float bottom
  });
});

describe("image-wrap behavior — caret positions & arrow-nav across the floated image", () => {
  it("document order is unchanged by floating: pre → img → para chain intact", () => {
    const editor = editorFrom(seedWithPredecessor("left"), createSpan(para(0), para(0)));
    const s = editor.state;
    expect(getBlock(s, "pre" as BlockId)?.nextSiblingId).toBe("img");
    expect(getBlock(s, "img" as BlockId)?.prevSiblingId).toBe("pre");
    expect(getBlock(s, "img" as BlockId)?.nextSiblingId).toBe("para");
    expect(getBlock(s, "para" as BlockId)?.prevSiblingId).toBe("img");
  });

  // The MOVE_CURSOR arrow-nav crossing assertions (ArrowRight/Left across the
  // float, atomic-leaf no-inner-caret) moved to the print backend's nav suite
  // (Phase 0b — geometric nav left core's reducer):
  // packages/print/src/nav/image-wrap-nav.test.ts.
});

describe("image-wrap behavior — hit-test around the floated image", () => {
  it("a click on the wrapped text (to the RIGHT of the float, on a narrowed line) resolves to the correct paragraph offset", () => {
    const editor = editorFrom(seed("left"), createSpan(para(0), para(0)));
    const tree = plainTree(editor);
    const lines = getLineIndex(tree).byBlock.get("para" as BlockId) ?? [];
    const first = nth(lines, 0, "line");
    // First (narrowed) line begins at absoluteX = W = 100. Click left-of-midpoint
    // of the 4th char ("d" of "alpha…" → offset 3) so findCharOffset rounds DOWN.
    const clickX = first.absoluteX + 3 * CHAR_W + 2;
    const y = first.absoluteY + LINE_H / 2;

    const hit = resolveHitPosition(editor.state, tree, measurer, clickX, y, 0);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.blockId).toBe("para");
    expect(hit.offset).toBe(3);

    // Round-trip: the caret for the resolved offset lands back at the click x.
    const caret = resolvePixelPosition(editor.state, para(hit.offset), tree, measurer);
    expect(caret).not.toBeNull();
    if (caret === null) return;
    expect(caret.x).toBe(first.absoluteX + 3 * CHAR_W); // 100 + 24 = 124
  });

  it("PRE-EXISTING ATOMIC-LEAF BOUNDARY: a click on the image's painted rect falls through to the paragraph (no line → not hit-testable), SAME as a non-floated image", () => {
    // Floated image: click its center.
    const floated = editorFrom(seed("left"), createSpan(para(0), para(0)));
    const fTree = plainTree(floated);
    const fImg = findBoxByKey(fTree, "img");
    expect(fImg).not.toBeNull();
    if (fImg === null) return;
    const fHit = resolveHitPosition(
      floated.state, fTree, measurer,
      fImg.x + fImg.inlineSize / 2, fImg.y + fImg.blockSize / 2, 0,
    );
    // Atomic-leaf blocks produce no LineBox; hit-test is line-based, so the click
    // resolves to the nearest paragraph line, NOT the image. An image can never
    // be a Selection focus (object-selection is unbuilt) — out of scope for Task 5.
    expect(fHit).not.toBeNull();
    expect(fHit?.blockId).toBe("para");

    // CONTROL: a NON-floated full-width image behaves identically → floating
    // neither introduces nor worsens this. Same boundary, in-flow box.
    const plain = editorFrom(seed(undefined), createSpan(para(0), para(0)));
    const pTree = plainTree(plain);
    const pImg = findBoxByKey(pTree, "img");
    expect(pImg).not.toBeNull();
    if (pImg === null) return;
    const pHit = resolveHitPosition(
      plain.state, pTree, measurer,
      pImg.x + pImg.inlineSize / 2, pImg.y + pImg.blockSize / 2, 0,
    );
    expect(pHit?.blockId).toBe("para");
  });
});

describe("image-wrap behavior — selection across the floated image", () => {
  it("a selection from before the image into the wrapped paragraph yields a contiguous, document-order range", () => {
    const editor = editorFrom(seedWithPredecessor("left"), createSpan(para(0), para(0)));
    // Anchor at the start of the preceding text, focus inside the wrapped para.
    const span = createSpan(createPosition("pre" as BlockId, 0), para(5));
    const rects = computeSelectionRects(editor.state, span, plainTree(editor), measurer);

    // The range spans two text blocks (pre + para) across the image → at least
    // two highlight rects, ordered top-to-bottom (document order). The image
    // contributes no rect of its own (no line), but the range stays contiguous:
    // it does not skip the image's document position — pre and para are adjacent
    // in the chain with only the (lineless) image between them.
    expect(rects.length).toBeGreaterThanOrEqual(2);
    const ys = rects.map((r) => r.y);
    const sortedYs = [...ys].sort((a, b) => a - b);
    expect(ys).toEqual(sortedYs); // already ascending → contiguous, in order
    // The first rect (pre) sits above the para rects (the float pushes para down).
    expect(nth(sortedYs, 0, "y")).toBeLessThan(nth(sortedYs, sortedYs.length - 1, "y"));
  });

  it("a selection covering the first narrowed line starts at the float-inset edge (x = W), not x = 0", () => {
    const editor = editorFrom(seed("left"), createSpan(para(0), para(0)));
    const tree = plainTree(editor);
    const lines = getLineIndex(tree).byBlock.get("para" as BlockId) ?? [];
    const first = nth(lines, 0, "line");
    // Select the first 4 chars of the first (narrowed) line.
    const span = createSpan(para(0), para(4));
    const rects = computeSelectionRects(editor.state, span, tree, measurer);
    expect(rects.length).toBeGreaterThanOrEqual(1);
    const r0 = nth(rects, 0, "rect");
    // The highlight begins at the narrowed line's inset edge (x = W = 100), proving
    // the selection geometry honors the float exclusion — not the page edge.
    expect(r0.x).toBe(first.absoluteX);
    expect(r0.x).toBe(W);
    expect(r0.width).toBe(4 * CHAR_W); // 32
  });
});

describe("image-wrap behavior — RTL", () => {
  it("wrap:left under direction:rtl paints the image at the physical LEFT edge with the wrapped text to its right", () => {
    // Google-Docs "left" is a PHYSICAL anchor: the image sits at the physical left
    // edge regardless of paragraph direction. Under rtl, imageWrapFloat("left",
    // "rtl") = "inline-end", and inline-end IS the physical-left edge in rtl — so
    // x=0 (physical left), and the narrowed lines are inset FROM the left.
    const editor = editorFrom(seed("left", "rtl"), createSpan(para(0), para(0)));
    const tree = plainTree(editor);
    const imgBox = findBoxByKey(tree, "img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) return;
    expect(imgBox.x).toBe(0); // physical left edge (page-padding inline-start = 0)
    expect(imgBox.inlineSize).toBe(W);

    const lines = paraLines(tree);
    const overlapping = lines.filter((l) => l.y < H);
    expect(overlapping.length).toBeGreaterThanOrEqual(1);
    for (const l of overlapping) {
      // Lines overlapping the float are inset from the physical left by W (text
      // sits to the RIGHT of the physically-left image), narrowed to W less.
      expect(l.x).toBe(W);
      expect(l.inlineSize).toBe(CONTAINER_W - W);
    }
  });

  it("wrap:right under direction:rtl paints the image at the physical RIGHT edge", () => {
    // Symmetric: "right" → physical right. imageWrapFloat("right","rtl") =
    // "inline-start" = physical-right edge in rtl → x = CONTAINER_W − W = 400.
    const editor = editorFrom(seed("right", "rtl"), createSpan(para(0), para(0)));
    const imgBox = findBoxByKey(plainTree(editor), "img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) return;
    expect(imgBox.x).toBe(CONTAINER_W - W); // 400 — physical right edge
    expect(imgBox.inlineSize).toBe(W);
  });
});

describe("image-wrap behavior — delete + undo restores the wrap attr", () => {
  it("deleting the floated image removes it; undo restores it WITH wrap:left and the paragraph re-narrows", () => {
    const config = makeConfig();
    // DELETE_FORWARD at the end of the preceding paragraph removes the atomic
    // image (atomic-leaf delete contract).
    const start = createPosition("pre" as BlockId, "PRE".length);
    const seeded = editorFrom(seedWithPredecessor("left"), createSpan(start, start));

    const deleted = reduceEditor(seeded, { type: "DELETE_FORWARD" }, config);
    expect(getBlock(deleted.state, "img" as BlockId)).toBeNull();
    // With the float gone, the paragraph reflows full-width (no inset line).
    const afterLines = paraLines(plainTree(deleted));
    expect(afterLines.length).toBeGreaterThanOrEqual(1);
    expect(afterLines[0]?.x).toBe(0);
    expect(afterLines[0]?.inlineSize).toBe(CONTAINER_W);

    // UNDO restores the image as a unit, INCLUDING its wrap attr…
    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    const restored = getBlock(undone.state, "img" as BlockId);
    expect(restored?.type).toBe("image");
    expect(restored?.attrs.wrap).toBe("left");
    // …and the restored image floats again (real box: x=0, W×H, inline-start)…
    const reImg = findBoxByKey(plainTree(undone), "img");
    expect(reImg).not.toBeNull();
    expect(reImg?.x).toBe(0);
    expect(reImg?.inlineSize).toBe(W);
    expect(reImg?.blockSize).toBe(H);
    // …so the paragraph RE-NARROWS around it — at least one wrapped line is inset
    // by the float width (x = W = 100, inlineSize = 400). (Which specific line is
    // inset depends on the float's block-axis anchor below the "PRE" paragraph; the
    // load-bearing fact is that the exclusion re-applies after undo. Verified
    // identical to a fresh rebuild from the restored state — this is the correct
    // post-undo layout, not an incremental-relayout artifact.)
    const reLines = paraLines(plainTree(undone));
    const reNarrowed = reLines.filter((l) => l.x === W && l.inlineSize === CONTAINER_W - W);
    expect(reNarrowed.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE_BACKWARD at the wrapped paragraph's start removes the image; the paragraph survives", () => {
    const config = makeConfig();
    const seeded = editorFrom(seedWithPredecessor("left"), createSpan(para(0), para(0)));

    const deleted = reduceEditor(seeded, { type: "DELETE_BACKWARD" }, config);
    expect(getBlock(deleted.state, "img" as BlockId)).toBeNull();
    expect(getBlock(deleted.state, "para" as BlockId)?.type).toBe("paragraph");
    // pre and para close up around the removed image.
    expect(getBlock(deleted.state, "pre" as BlockId)?.nextSiblingId).toBe("para");
    expect(getBlock(deleted.state, "para" as BlockId)?.prevSiblingId).toBe("pre");
  });
});
