/**
 * Object-selection hit-test (#525, Task 3). A click INSIDE an image's rect must
 * select the image as an OBJECT — the hit-test returns the collapsed-on-atomic
 * position `{imageId, 0}` with `caretAffinity: "after"`, taking priority over the
 * LineBox-based text fall-through. Images render as a `BlockBox` (no `LineBox`),
 * so without the atomic pre-pass a click on an image resolves to the nearest text
 * caret.
 *
 * The atomic pre-pass is GATED on the OPTIONAL `resolver` argument: present →
 * point-in-rect over the `AtomicBoxIndex` wins; absent → behavior is UNCHANGED
 * (existing text logic), proving backward-compat for every existing caller.
 *
 * Fixture mirrors `atomic-box-index.test.ts` (buildState → render → layoutTree →
 * getPage(0)) with a FLOATED image and wrapped paragraph text beside it.
 */
import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";
import type { State } from "@taleweaver/core";
import type { PageBox } from "../layout/page-box";
import type { LayoutBox, BlockBox } from "../layout/layout-box";
import { resolvePositionFromPixel } from "./hit-test";
import { getAtomicBoxIndex } from "./atomic-box-index";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

const FLOAT_IMG_ID = asBlockId("float-img");
const PARA_ID = asBlockId("para");
const PLAIN_ID = asBlockId("plain");

const IMG_W = 100;
const IMG_H = 60;

function pageConfig() {
  return {
    pageInlineSize: 500,
    pageBlockSize: 600,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/**
 * `[floated image] [paragraph that wraps BESIDE the float] [plain paragraph]`.
 * The floated image carries `wrap:"left"` (→ logical inline-start float). The
 * paragraph holds enough text to wrap and flow beside the float, so a click in
 * its wrapped text (outside the image rect) must resolve to a TEXT position.
 */
function docWithFloatImage(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "float-img",
        lastChildId: "plain",
      }),
      buildBlock({
        id: "float-img",
        type: "image",
        parentId: "doc",
        nextSiblingId: "para",
        attrs: { src: "float.png", width: IMG_W, height: IMG_H, wrap: "left" },
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "float-img",
        nextSiblingId: "plain",
        inlineContent: inlineContent([
          text("the quick brown fox jumps over the lazy dog again and again"),
        ]),
      }),
      buildBlock({
        id: "plain",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "para",
        inlineContent: inlineContent([text("plain paragraph text here")]),
      }),
    ],
  });
}

interface Built {
  state: State;
  page0: PageBox;
}

function build(): Built {
  const state = docWithFloatImage();
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const cfg = pageConfig();
  const lt = layoutTree(root, cfg.pageInlineSize, shaper, cfg);
  if (lt.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated supported doc)");
  }
  return { state, page0: lt.getPage(0) };
}

/** Find the first `BlockBox` with `key === key`, descending children/columns. */
function findBlockBoxByKey(box: LayoutBox, key: string): BlockBox | null {
  if (box.type === "block" && box.key === key) return box;
  if (box.type === "text-run" || box.type === "marker") return null;
  if (box.type === "multicolumn") {
    for (const col of box.columns) {
      const r = findBlockBoxByKey(col, key);
      if (r !== null) return r;
    }
  } else if ("children" in box) {
    for (const child of box.children) {
      const r = findBlockBoxByKey(child, key);
      if (r !== null) return r;
    }
  }
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      const r = findBlockBoxByKey(absChild, key);
      if (r !== null) return r;
    }
  }
  return null;
}

describe("resolvePositionFromPixel — object-selection (#525)", () => {
  it("a click INSIDE the floated image's rect selects the image as an object", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();

    const rect = getAtomicBoxIndex(page0, resolver, state).get(FLOAT_IMG_ID);
    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error("float-img not indexed");

    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);

    const hit = resolvePositionFromPixel(state, page0, shaper, cx, cy, 0, resolver);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error("expected a hit inside the image rect");
    expect(hit.position.blockId).toBe(FLOAT_IMG_ID);
    expect(hit.position.offset).toBe(0);
    expect(hit.caretAffinity).toBe("after");
  });

  it("a click in the wrapped text BESIDE the floated image resolves to text", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();

    const rect = getAtomicBoxIndex(page0, resolver, state).get(FLOAT_IMG_ID);
    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error("float-img not indexed");

    // Click just to the RIGHT of the image, within its block band (so the same
    // y as the image but past its right edge — where the paragraph text wraps).
    const tx = rect.x + rect.width + 10;
    const ty = rect.y + rect.height / 2;
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);

    const hit = resolvePositionFromPixel(state, page0, shaper, tx, ty, 0, resolver);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error("expected a text hit beside the image");
    // Must be the wrapped paragraph, NOT the image.
    expect(hit.position.blockId).toBe(PARA_ID);
  });

  it("a click on a plain paragraph (resolver passed) is an unchanged text hit", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);

    const plainBox = findBlockBoxByKey(page0, "plain");
    expect(plainBox).not.toBeNull();
    if (plainBox === null) throw new Error("plain box missing");

    // Compute the plain paragraph's absolute rect by walking from the page.
    const plainRect = absRectOf(page0, "plain", 0, 0);
    expect(plainRect).not.toBeNull();
    if (plainRect === null) throw new Error("plain geometry missing");
    // Click PAST the float's inline extent (x > IMG_W) so the point is over the
    // plain paragraph's text, NOT inside the inline-start float rect. The float
    // occupies [0, IMG_W) horizontally; a click at x = IMG_W + 4 is clear of it.
    const px = plainRect.x + IMG_W + 4;
    const py = plainRect.y + plainRect.height / 2;

    const withResolver = resolvePositionFromPixel(state, page0, shaper, px, py, 0, resolver);
    const withoutResolver = resolvePositionFromPixel(state, page0, shaper, px, py, 0);
    expect(withResolver).not.toBeNull();
    if (withResolver === null) throw new Error("expected a text hit on the plain para");
    expect(withResolver.position.blockId).toBe(PLAIN_ID);
    // Resolver must not perturb a non-atomic click — identical to no-resolver.
    expect(withResolver).toEqual(withoutResolver);
  });

  it("WITHOUT a resolver, a click over the image falls through to text (no regression)", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();

    const rect = getAtomicBoxIndex(page0, resolver, state).get(FLOAT_IMG_ID);
    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error("float-img not indexed");

    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);

    // Omit the resolver → the old text-fall-through path. The click is over the
    // image (no LineBox there) so it resolves to the nearest text caret — NOT
    // the image block.
    const hit = resolvePositionFromPixel(state, page0, shaper, cx, cy, 0);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error("expected a text fall-through hit");
    expect(hit.position.blockId).not.toBe(FLOAT_IMG_ID);
  });
});

/**
 * Compute a box's absolute physical rect by walking the page (mirrors the index
 * accumulation), descending slots + abs-pos children.
 */
function absRectOf(
  box: LayoutBox,
  targetKey: string,
  absX: number,
  absY: number,
): { x: number; y: number; width: number; height: number } | null {
  if (box.type === "page") {
    for (const child of box.children) {
      const r = absRectOf(child, targetKey, 0, 0);
      if (r !== null) return r;
    }
    return null;
  }
  if (box.type === "text-run" || box.type === "marker") return null;
  const x = absX + box.x;
  const y = absY + box.y;
  if (box.type === "block" && box.key === targetKey) {
    return { x, y, width: box.width, height: box.height };
  }
  if (box.type === "multicolumn") {
    for (const col of box.columns) {
      const r = absRectOf(col, targetKey, x, y);
      if (r !== null) return r;
    }
  } else if ("children" in box) {
    for (const child of box.children) {
      const r = absRectOf(child, targetKey, x, y);
      if (r !== null) return r;
    }
  }
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      const r = absRectOf(absChild, targetKey, x, y);
      if (r !== null) return r;
    }
  }
  return null;
}
