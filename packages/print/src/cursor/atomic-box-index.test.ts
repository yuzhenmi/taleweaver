/**
 * AtomicBoxIndex (#525, Task 2). A per-page map from an atomic-leaf block id
 * (image / horizontal-line) to its ABSOLUTE physical pixel rect. These blocks
 * render as a `BlockBox` with `key === blockId` and `metadata.image` / hr
 * metadata, producing NO `LineBox` — so the LineBox-canonical hit-test can't
 * see them. This index is the geometry source the object-selection hit-test
 * (Task 3) and selection-geometry (Task 4) consume.
 *
 * Fixture pattern mirrors `cursor-position-virtual.test.ts` (buildState →
 * render → layoutTree → getPage(0)) and the image-block shape from
 * `object-selection.test.ts` (an atomic-leaf `image` block carrying
 * `attrs.{src,width,height}`; the floated one adds `attrs.wrap`).
 */
import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass, type PagePlan, type PagePlanEntry } from "../layout/measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../layout/section-plan";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeVirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { ElementBox } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";
import type { LayoutBox, BlockBox } from "../layout/layout-box";
import type { PageBox } from "../layout/page-box";
import { getAtomicBoxIndex } from "./atomic-box-index";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

const PARA_ID = asBlockId("para");
const INFLOW_IMG_ID = asBlockId("inflow-img");
const FLOAT_IMG_ID = asBlockId("float-img");

const IMG_W = 100;
const IMG_H = 60;

/**
 * Generous page so the paragraph + both images fit on page 0. No margins so
 * page-content origin is (0, 0).
 */
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 500,
    pageBlockSize: 600,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/**
 * `[para "above"] [floated image] [in-flow image]` under the doc root. The
 * floated image carries `wrap:"left"` (→ logical `inline-start` float); the
 * in-flow image is a plain `display:block` atomic leaf. Both are atomic-leaf
 * blocks (no children, no inlineContent).
 */
function docWithImages(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "para",
        lastChildId: "inflow-img",
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "float-img",
        inlineContent: inlineContent([text("above")]),
      }),
      buildBlock({
        id: "float-img",
        type: "image",
        parentId: "doc",
        prevSiblingId: "para",
        nextSiblingId: "inflow-img",
        attrs: { src: "float.png", width: IMG_W, height: IMG_H, wrap: "left" },
      }),
      buildBlock({
        id: "inflow-img",
        type: "image",
        parentId: "doc",
        prevSiblingId: "float-img",
        attrs: { src: "inflow.png", width: IMG_W, height: IMG_H },
      }),
    ],
  });
}

interface Built {
  state: State;
  page0: PageBox;
}

function build(): Built {
  const state = docWithImages();
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

const HEADER_ROOT = asBlockId("hdr-root");
const HEADER_IMG_ID = asBlockId("hdr-img");

/**
 * Build a single-page doc whose header body (a `template-body` CONTAINER stored
 * in templateContents, mirroring a real INSERT_HEADER body — #326) holds one
 * atomic IMAGE child, lay it out paginated, and tag page 0's plan entry with the
 * header root so the slot is materialized. Returns page 0's `PageBox` with the
 * header image living under `headerSlot`.
 *
 * Non-trivially exercises the Finding-1 fix: the image block lives ONLY in the
 * templateContents tree, so it is resolvable via `resolveBlock` (all three
 * trees) but invisible to the old main-tree-only `getBlock` — the old code would
 * silently drop it from the index. Reuses the header-slot machinery from
 * `header-slot-cursor.test.ts`.
 */
function buildWithHeaderImage(): Built {
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: HEADER_ROOT,
        type: "template-body",
        firstChildId: HEADER_IMG_ID,
        lastChildId: HEADER_IMG_ID,
      }),
      buildBlock({
        id: HEADER_IMG_ID,
        type: "image",
        parentId: HEADER_ROOT,
        attrs: { src: "hdr.png", width: IMG_W, height: IMG_H },
      }),
    ],
  });

  const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");
  const cascadedTemplateContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.templateContents) {
    const c = cascadePass(node);
    if (c.type === "element") cascadedTemplateContents.set(id, c);
  }

  // Header band needs vertical room: non-zero top margin so the slot has space.
  const cfg: PageConfig = {
    pageInlineSize: 500,
    pageBlockSize: 600,
    pageMargins: { blockStart: 80, blockEnd: 40, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const pcis = cfg.pageInlineSize - cfg.pageMargins.inlineStart - cfg.pageMargins.inlineEnd;
  const metas = buildBlockFitMetas(cascadedRoot, shaper, undefined, pcis);
  const basePlan = measurePass(metas, cfg, IMPLICIT_SECTION_PLAN, cascadedRoot.children);
  // Tag page 0 with the header id (what the section plan does in production).
  const plan = planWithHeader(basePlan);

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  return { state, page0: virtual.getPage(0) };
}

/**
 * Rebuild `base` with `HEADER_ROOT` tagged onto page 0's plan entry and the
 * slot-body → first-page map updated to match (mirrors `header-slot-cursor`'s
 * `planWithEntries`, specialized to a single header on a single page).
 */
function planWithHeader(base: PagePlan): PagePlan {
  let running = 0;
  const entries: PagePlanEntry[] = base.entries.map((e) => {
    const tagged = e.pageIndex === 0 ? { ...e, headerBlockId: HEADER_ROOT } : e;
    const withOffset: PagePlanEntry = {
      ...tagged,
      blockOffset: running,
      blockSize: tagged.pageConfig.pageBlockSize,
    };
    running += tagged.pageConfig.pageBlockSize + tagged.pageConfig.pageGap;
    return withOffset;
  });
  const last = entries[entries.length - 1];
  const totalBlockSize = last === undefined ? 0 : last.blockOffset + last.pageConfig.pageBlockSize;
  const templateBlockToPage = new Map<string, number>();
  for (const e of entries) {
    if (e.headerBlockId !== undefined && !templateBlockToPage.has(e.headerBlockId)) {
      templateBlockToPage.set(e.headerBlockId, e.pageIndex);
    }
  }
  return {
    entries,
    sectionPlan: base.sectionPlan,
    totalBlockSize,
    pageInlineSize: base.pageInlineSize,
    pageContentBlockSize: base.pageContentBlockSize,
    pageIndexAtBlockOffset: base.pageIndexAtBlockOffset.bind(base),
    pageIndexOfBlock: base.pageIndexOfBlock.bind(base),
    pageSpanOfBlock: base.pageSpanOfBlock.bind(base),
    pageIndexOfTemplateBlock: (blockId) => templateBlockToPage.get(blockId) ?? -1,
    pageIndexOfFootnoteBlock: () => -1,
  };
}

/**
 * Find the first `BlockBox` with `key === key` in the subtree, else null.
 * Descends the page's header/footer/footnote slots and every box's
 * `absoluteChildren` so a target inside a slot or an abs-pos subtree is found.
 */
function findBlockBoxByKey(box: LayoutBox, key: string): BlockBox | null {
  if (box.type === "block" && box.key === key) return box;
  if (box.type === "page") {
    if (box.headerSlot !== null) {
      const r = findBlockBoxByKey(box.headerSlot, key);
      if (r !== null) return r;
    }
    for (const child of box.children) {
      const r = findBlockBoxByKey(child, key);
      if (r !== null) return r;
    }
    if (box.footerSlot !== null) {
      const r = findBlockBoxByKey(box.footerSlot, key);
      if (r !== null) return r;
    }
    if (box.footnoteSlot !== null) {
      const r = findBlockBoxByKey(box.footnoteSlot, key);
      if (r !== null) return r;
    }
    return null;
  }
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

/**
 * Compute a box's ABSOLUTE physical rect by walking the page from the root and
 * accumulating physical `x`/`y` (the same accumulation the index does), so the
 * test cross-checks against an independent geometry walk rather than the
 * index's own internals. Structurally faithful to the impl walker: it descends
 * the page's `headerSlot`/`footerSlot`/`footnoteSlot` (page-local origin (0, 0))
 * and every box's `absoluteChildren` (same (absX, absY) parent frame as
 * `children`), so a target inside a slot or an abs-pos subtree is reachable.
 */
function absRectOf(
  box: LayoutBox,
  targetKey: string,
  absX: number,
  absY: number,
): { x: number; y: number; width: number; height: number } | null {
  if (box.type === "page") {
    if (box.headerSlot !== null) {
      const r = absRectOf(box.headerSlot, targetKey, 0, 0);
      if (r !== null) return r;
    }
    for (const child of box.children) {
      const r = absRectOf(child, targetKey, 0, 0);
      if (r !== null) return r;
    }
    if (box.footerSlot !== null) {
      const r = absRectOf(box.footerSlot, targetKey, 0, 0);
      if (r !== null) return r;
    }
    if (box.footnoteSlot !== null) {
      const r = absRectOf(box.footnoteSlot, targetKey, 0, 0);
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
  // Abs-pos descendants share THIS box's frame (same parent origin as children)
  // and are OUT of `children` — descend them so an abs-pos target is reachable.
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      const r = absRectOf(absChild, targetKey, x, y);
      if (r !== null) return r;
    }
  }
  return null;
}

describe("getAtomicBoxIndex (#525)", () => {
  it("maps the in-flow image block id to its absolute physical rect", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    const index = getAtomicBoxIndex(page0, resolver, state);

    // Sanity: the in-flow image box exists and carries image metadata.
    const imgBox = findBlockBoxByKey(page0, "inflow-img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) throw new Error("inflow-img box missing");
    expect(imgBox.metadata?.image).toBeDefined();

    const expected = absRectOf(page0, "inflow-img", 0, 0);
    expect(expected).not.toBeNull();
    if (expected === null) throw new Error("inflow-img geometry missing");

    expect(index.get(INFLOW_IMG_ID)).toEqual({
      x: expected.x,
      y: expected.y,
      width: expected.width,
      height: expected.height,
      pageIndex: 0,
    });
  });

  it("maps the floated image block id to its float-placement absolute rect", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    const index = getAtomicBoxIndex(page0, resolver, state);

    const expected = absRectOf(page0, "float-img", 0, 0);
    expect(expected).not.toBeNull();
    if (expected === null) throw new Error("float-img geometry missing");

    expect(index.get(FLOAT_IMG_ID)).toEqual({
      x: expected.x,
      y: expected.y,
      width: expected.width,
      height: expected.height,
      pageIndex: 0,
    });
  });

  it("does NOT index inline-bearing (paragraph) blocks", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    const index = getAtomicBoxIndex(page0, resolver, state);
    expect(index.has(PARA_ID)).toBe(false);
  });

  it("memoizes by page-box identity (same reference on repeat calls)", () => {
    const { state, page0 } = build();
    const resolver = createDefaultComponentRegistry();
    const a = getAtomicBoxIndex(page0, resolver, state);
    const b = getAtomicBoxIndex(page0, resolver, state);
    expect(a).toBe(b);
  });

  // Finding-1 fix (cross-tree resolution): an atomic image in a HEADER body
  // lives only in templateContents — resolvable via `resolveBlock` (all three
  // trees) but invisible to the old main-tree-only `getBlock`. With `getBlock`
  // the image was silently dropped; with `resolveBlock` it is indexed. The
  // cross-check `absRectOf` is now slot-aware so the assertion is non-vacuous.
  it("indexes an atomic image living in a header (templateContents) slot", () => {
    const { state, page0 } = buildWithHeaderImage();
    const resolver = createDefaultComponentRegistry();
    const index = getAtomicBoxIndex(page0, resolver, state);

    // Sanity: the header image box actually materialized into the headerSlot.
    expect(page0.headerSlot).not.toBeNull();
    const imgBox = findBlockBoxByKey(page0, "hdr-img");
    expect(imgBox).not.toBeNull();
    if (imgBox === null) throw new Error("hdr-img box missing");
    expect(imgBox.metadata?.image).toBeDefined();

    const expected = absRectOf(page0, "hdr-img", 0, 0);
    expect(expected).not.toBeNull();
    if (expected === null) throw new Error("hdr-img geometry missing");

    expect(index.get(HEADER_IMG_ID)).toEqual({
      x: expected.x,
      y: expected.y,
      width: expected.width,
      height: expected.height,
      pageIndex: 0,
    });
  });
});
