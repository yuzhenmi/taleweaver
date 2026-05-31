import { describe, it, expect } from "vitest";
import type { ElementBox, RenderNode } from "../render/render-node";
import { createElementBox, createTextBox } from "../render/render-node";
import type { Style } from "../styles";
import type { BlockId } from "../state";
import type { FootnoteAnchorRef } from "../footnotes";
import { measurePass, type PagePlan } from "./measure-pass";
import { buildBlockFitMetas } from "./build-fit-metas";
import {
  buildSectionPlan,
  IMPLICIT_SECTION_PLAN,
  sectionStateAt,
  type SectionPlan,
} from "./section-plan";
import { flattenContents } from "./group-children";
import { cascadePass, cascadePassIncremental } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { PageConfig } from "./page-config";
import {
  buildBlockToTopLevelIndex,
  buildFootnotePageAssignment,
  resolveFootnotes,
  FOOTNOTE_SEPARATOR_HEIGHT,
  MIN_BODY_BLOCK_SIZE,
  __getBodyLayoutCallCountForTest,
  __resetBodyLayoutCallCountForTest,
} from "./resolve-footnotes";
import { buildVirtualPaginatedTree } from "./virtual-producer";

const EMPTY_STYLE: Style = {};

function elem(key: string): ElementBox {
  return createElementBox(key, EMPTY_STYLE, []);
}

function anchor(
  blockId: string,
  contentBlockId: string,
): FootnoteAnchorRef {
  return {
    blockId: blockId as BlockId,
    contentBlockId: contentBlockId as BlockId,
    sectionId: null,
  };
}

/**
 * A minimal typed PagePlan stub exposing only the two methods
 * `buildFootnotePageAssignment` consumes. `spans` maps a block key to its
 * inclusive page span; `pageIndexOfBlock` returns the LAST page of the span
 * (matching the real plan's whole-block-progress semantics), and
 * `pageSpanOfBlock` returns the full span. Keys absent from `spans` resolve to
 * `-1` / `null`, exactly like the real plan.
 */
function stubPlan(
  spans: Record<string, { first: number; last: number }>,
): PagePlan {
  const stub: Pick<PagePlan, "pageIndexOfBlock" | "pageSpanOfBlock"> = {
    pageIndexOfBlock(blockKey: string): number {
      const span = spans[blockKey];
      return span === undefined ? -1 : span.last;
    },
    pageSpanOfBlock(
      blockKey: string,
    ): { readonly first: number; readonly last: number } | null {
      const span = spans[blockKey];
      return span === undefined ? null : { first: span.first, last: span.last };
    },
  };
  return stub as PagePlan;
}

describe("buildBlockToTopLevelIndex", () => {
  it("maps each top-level child key to its index", () => {
    const children: ElementBox[] = [elem("a"), elem("b"), elem("c")];
    const map = buildBlockToTopLevelIndex(children);
    expect(map.get("a" as BlockId)).toBe(0);
    expect(map.get("b" as BlockId)).toBe(1);
    expect(map.get("c" as BlockId)).toBe(2);
    expect(map.size).toBe(3);
  });

  it("returns an empty map for empty input", () => {
    const map = buildBlockToTopLevelIndex([]);
    expect(map.size).toBe(0);
  });
});

describe("buildFootnotePageAssignment", () => {
  it("places two anchors on their respective pages", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 1, last: 1 },
    });
    const anchors = [anchor("b0", "fn0"), anchor("b1", "fn1")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(0)).toEqual(["fn0" as BlockId]);
    expect(result.get(1)).toEqual(["fn1" as BlockId]);
  });

  it("groups two same-page anchors in document order", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 0, last: 0 },
    });
    // Document order: fnA before fnB.
    const anchors = [anchor("b0", "fnA"), anchor("b1", "fnB")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(0)).toEqual(["fnA" as BlockId, "fnB" as BlockId]);
    expect(result.size).toBe(1);
  });

  it("assigns a page-spanning anchor's block to the FIRST page of the span", () => {
    const children: ElementBox[] = [elem("bSpan")];
    const index = buildBlockToTopLevelIndex(children);
    // Block spans pages 2..4; pageIndexOfBlock would return 4 (last), but the
    // assignment must use the FIRST page (2) per plan decision D4.
    const plan = stubPlan({ bSpan: { first: 2, last: 4 } });
    const anchors = [anchor("bSpan", "fnSpan")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(2)).toEqual(["fnSpan" as BlockId]);
    expect(result.has(4)).toBe(false);
  });

  it("returns an empty map for empty anchors", () => {
    const index = buildBlockToTopLevelIndex([elem("b0")]);
    const plan = stubPlan({ b0: { first: 0, last: 0 } });

    const result = buildFootnotePageAssignment([], plan, index);

    expect(result.size).toBe(0);
  });

  /**
   * Run `fn` with NODE_ENV forced to "production" (so `isDevMode()` is false),
   * restoring the prior value afterward. Used to exercise the graceful-skip
   * path: in dev the defensive cases throw (loud), in prod they skip (safe).
   */
  function inProduction<T>(fn: () => T): T {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const env = proc?.env;
    const prev = env?.NODE_ENV;
    if (env !== undefined) env.NODE_ENV = "production";
    try {
      return fn();
    } finally {
      if (env !== undefined) env.NODE_ENV = prev;
    }
  }

  it("throws in dev for an anchor whose blockId is absent from the top-level index", () => {
    const children: ElementBox[] = [elem("b0")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      nested: { first: 0, last: 0 },
    });
    // "nested" is not a top-level child key (anchor nested in a non-transparent
    // container, out of FN-4 scope) → dev-only throw so it can't silently vanish.
    const anchors = [anchor("b0", "fnKept"), anchor("nested", "fnSkipped")];

    expect(() => buildFootnotePageAssignment(anchors, plan, index)).toThrow(
      /not a top-level child/,
    );
  });

  it("skips (not throws) the nested anchor gracefully in production", () => {
    const children: ElementBox[] = [elem("b0")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      nested: { first: 0, last: 0 },
    });
    const anchors = [anchor("b0", "fnKept"), anchor("nested", "fnSkipped")];

    const result = inProduction(() =>
      buildFootnotePageAssignment(anchors, plan, index),
    );

    expect(result.get(0)).toEqual(["fnKept" as BlockId]);
    expect([...result.values()].flat()).not.toContain("fnSkipped" as BlockId);
  });

  it("throws in dev for an anchor whose block has no resolvable page span", () => {
    const children: ElementBox[] = [elem("b0"), elem("bMissing")];
    const index = buildBlockToTopLevelIndex(children);
    // bMissing is a top-level child but absent from the plan's spans
    // (structural inconsistency: pageSpanOfBlock returns null).
    const plan = stubPlan({ b0: { first: 0, last: 0 } });
    const anchors = [anchor("b0", "fnKept"), anchor("bMissing", "fnNoPage")];

    expect(() => buildFootnotePageAssignment(anchors, plan, index)).toThrow(
      /no resolvable page span/,
    );
  });

  it("skips (not throws) the no-span anchor gracefully in production", () => {
    const children: ElementBox[] = [elem("b0"), elem("bMissing")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({ b0: { first: 0, last: 0 } });
    const anchors = [anchor("b0", "fnKept"), anchor("bMissing", "fnNoPage")];

    const result = inProduction(() =>
      buildFootnotePageAssignment(anchors, plan, index),
    );

    expect(result.get(0)).toEqual(["fnKept" as BlockId]);
    expect([...result.values()].flat()).not.toContain("fnNoPage" as BlockId);
  });
});

// ===========================================================================
// resolveFootnotes — the FN-4.2 forward-sweep (no splitting). These drive the
// REAL render→cascade→buildBlockFitMetas→measurePass flow, then resolveFootnotes,
// asserting GEOMETRY (slot heights, child-slice shifts, next-page startIndex)
// per CLAUDE.md — not just counts.
// ===========================================================================

const FN_SHAPER = createMockShaper(8, 16); // 16px line-height, 8px/char.
const FN_CONTENT_INLINE = 600;

// 64px content per page ⇒ 4 single-line (16px) paragraphs per page, no margins.
const FN_PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 64,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/** A single-line paragraph (block whose only content is a text run) → 16px. */
function fnPara(key: string, text = "x"): ElementBox {
  return createElementBox(key, { display: "block" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/** A footnote body: a container block holding `lines` single-line paragraphs. */
function fnBody(key: string, lines: number): ElementBox {
  const children: RenderNode[] = [];
  for (let i = 0; i < lines; i++) children.push(fnPara(`${key}-p${i}`));
  return createElementBox(key, { display: "block" } as Style, children);
}

function fnDoc(children: readonly RenderNode[]): ElementBox {
  return createElementBox("doc", { display: "block" } as Style, children);
}

function fnCascade(root: ElementBox): ElementBox {
  const c = cascadePass(root);
  if (c.type !== "element") throw new Error("cascadePass returned non-element");
  return c;
}

function fnAnchor(blockId: string, contentBlockId: string): FootnoteAnchorRef {
  return {
    blockId: blockId as BlockId,
    contentBlockId: contentBlockId as BlockId,
    sectionId: null,
  };
}

/**
 * Build the inputs for `resolveFootnotes` from a render-doc root + a set of
 * footnote bodies (each laid out via `cascadePass`). Returns the raw measurePass
 * plan + everything `resolveFootnotes` needs.
 */
function setup(
  renderRoot: ElementBox,
  bodies: ReadonlyMap<string, ElementBox>,
  pageConfig: PageConfig = FN_PAGE,
): {
  rawPlan: PagePlan;
  metas: ReturnType<typeof buildBlockFitMetas>;
  sectionPlan: ReturnType<typeof buildSectionPlan>;
  rootChildren: ElementBox[];
  cascadedEmbedContents: Map<BlockId, ElementBox>;
  ctx: ReturnType<typeof makeRootContext>;
  pageConfig: PageConfig;
} {
  const cascaded = fnCascade(renderRoot);
  const metas = buildBlockFitMetas(cascaded, FN_SHAPER, FN_CONTENT_INLINE);
  const sectionPlan = buildSectionPlan(cascaded, pageConfig);
  const rootChildren = flattenContents(cascaded.children) as ElementBox[];
  const rawPlan = measurePass(metas, pageConfig, sectionPlan, rootChildren);

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of bodies) {
    cascadedEmbedContents.set(id as BlockId, fnCascade(body));
  }

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
  return { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig };
}

describe("resolveFootnotes", () => {
  it("(a) no anchors → returns the rawPlan by reference (no-op)", () => {
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map());

    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, [], ctx, FN_SHAPER, undefined, pageConfig,
    );

    expect(out).toBe(rawPlan); // ref-equal no-op
  });

  it("(b) all anchors skipped (nested, non-top-level) → ref-equal rawPlan (prod skip)", () => {
    const render = fnDoc([fnPara("b0")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fnX", fnBody("fnX", 1)]]));

    // Anchor's blockId "nested" is not a top-level child key. In production
    // `buildFootnotePageAssignment` skips it → anchorsByPage is empty → no-op.
    const anchors = [fnAnchor("nested", "fnX")];

    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const env = proc?.env;
    const prev = env?.NODE_ENV;
    if (env !== undefined) env.NODE_ENV = "production";
    try {
      const out = resolveFootnotes(
        rawPlan, metas, sectionPlan, rootChildren,
        cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
      );
      expect(out).toBe(rawPlan);
    } finally {
      if (env !== undefined) env.NODE_ENV = prev;
    }
  });

  it("(c) single footnote on a page → footnoteSlotHeight ≈ body + separator; reduced space evicts a block to the next page", () => {
    // 4 paras fit one page (64px / 16px). A footnote on b0 (page 0) reserves a
    // 1-line body (16) + separator (13) = 29px slot, leaving 35px ⇒ only 2 paras
    // fit on page 0. So b2 (and b3) shift to a NEW page.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fn0", fnBody("fn0", 1)]]));

    // RAW: single page, all 4 blocks.
    expect(rawPlan.entries.length).toBe(1);
    expect(rawPlan.entries[0].children.length).toBe(4);

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    expect(out).not.toBe(rawPlan);
    // Page 0 carries the footnote: slot = 1 line (16) + separator (13) = 29.
    expect(out.entries[0].footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(out.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    // The reduced space evicts blocks: page 0 now holds FEWER than the raw 4.
    expect(out.entries[0].children.length).toBeLessThan(4);
    // Specifically 35px / 16px ⇒ 2 paras on page 0.
    expect(out.entries[0].children.length).toBe(2);
    // Evicted blocks shifted to a new page whose startIndex moved past page 0.
    expect(out.entries.length).toBeGreaterThan(1);
    expect(out.entries[1].startIndex).toBe(2);
    expect(out.entries[1].footnoteSlotHeight).toBe(0); // page 1 has no footnote
    // The plan's index methods reflect the NEW boundaries.
    expect(out.pageIndexOfBlock("b2")).toBe(1);
    expect(out.pageIndexOfBlock("b0")).toBe(0);
  });

  it("(d) two footnotes on one page stack: footnoteSlotHeight = sum + separator", () => {
    // b0 carries fnA (1 line), b1 carries fnB (1 line); both on page 0. Use a
    // TALL page (128px) so the 45px two-body slot does not evict either anchor
    // block — the slot stacking is what's under test here, not eviction.
    const TALL: PageConfig = { ...FN_PAGE, pageBlockSize: 128 };
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([
        ["fnA", fnBody("fnA", 1)],
        ["fnB", fnBody("fnB", 1)],
      ]), TALL);

    const anchors = [fnAnchor("b0", "fnA"), fnAnchor("b1", "fnB")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    // Two 1-line bodies (16 each) + ONE separator (13) = 45.
    expect(out.entries[0].footnoteContentBlockIds).toEqual([
      "fnA" as BlockId,
      "fnB" as BlockId,
    ]);
    expect(out.entries[0].footnoteSlotHeight).toBe(16 + 16 + FOOTNOTE_SEPARATOR_HEIGHT);
  });

  it("(e) self-eviction 2-cycle: a footnote whose slot evicts its OWN anchor block sends block+footnote forward together (atomic rule)", () => {
    // 4 paras; b3 carries a footnote. RAW: all 4 on page 0, so b3 (with the
    // anchor) is on page 0. This is the SELF-EVICTION case: reserving the
    // footnote's 29px slot leaves 35px ⇒ only 2 paras fit ⇒ b3 (the anchor
    // block itself) is EVICTED. Placing b3 forces the slot, which evicts b3 —
    // no stable single-page fixpoint, so the assigned set TOGGLES (b3-on /
    // b3-off): a 2-cycle.
    //
    // The `seen`-set 2-cycle detector fires and applies the atomic-block rule
    // (matches Google Docs): page 0 is capped BEFORE b3's anchor index, so b3
    // and its footnote travel FORWARD together to the next page — neither the
    // block nor its footnote is ever lost. Page 0 ends WITHOUT the slot (b3
    // left); the page that actually carries b3 gets the slot.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fn3", fnBody("fn3", 1)]]));

    expect(rawPlan.pageIndexOfBlock("b3")).toBe(0); // raw: b3 on page 0

    const anchors = [fnAnchor("b3", "fn3")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    // After convergence: b3 ended up on a later page; the footnote slot is on
    // whatever page actually carries b3 (NOT page 0, which b3 left).
    const b3Page = out.pageIndexOfBlock("b3");
    expect(b3Page).toBeGreaterThan(0);
    expect(out.entries[b3Page].footnoteContentBlockIds).toEqual(["fn3" as BlockId]);
    expect(out.entries[b3Page].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    // Pages that lost the footnote during convergence carry NO slot.
    expect(out.entries[0].footnoteContentBlockIds).toEqual([]);
    expect(out.entries[0].footnoteSlotHeight).toBe(0);
  });

  it("(f) D5 clamp: a body taller than the bounded area is clamped; page stays valid // FN-5", () => {
    // A 10-line body (160px) on a 64px-content page would consume the whole
    // page. D5 clamps the slot to `pageContentBlockSize − MIN_BODY_BLOCK_SIZE`
    // (64 − 16 = 48) so the body keeps ≥1 line. // FN-5: real split lands later.
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fnBig", fnBody("fnBig", 10)]]));

    const anchors = [fnAnchor("b0", "fnBig")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    // Slot CLAMPED to pageContentBlockSize − MIN_BODY_BLOCK_SIZE, NOT the raw
    // 160 + 13. // FN-5: this clamp is the seam for body splitting.
    const clampMax = FN_PAGE.pageBlockSize - MIN_BODY_BLOCK_SIZE;
    expect(out.entries[0].footnoteSlotHeight).toBe(clampMax);
    expect(out.entries[0].footnoteSlotHeight).toBeLessThan(16 * 10 + FOOTNOTE_SEPARATOR_HEIGHT);
    // The page stays valid: the body content area retains ≥ MIN_BODY (≥1 line),
    // so at least one block still fits on page 0.
    expect(out.entries[0].children.length).toBeGreaterThanOrEqual(1);
  });

  it("pages before the first footnote page are copied through unchanged (ref-equal entries)", () => {
    // 8 paras ⇒ 2 pages (4 each). A footnote on b4 (page 1) leaves page 0
    // untouched: the entry must be the SAME object reference.
    const render = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"), fnPara("b6"), fnPara("b7"),
    ]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fn4", fnBody("fn4", 1)]]));

    expect(rawPlan.entries.length).toBe(2);
    expect(rawPlan.pageIndexOfBlock("b4")).toBe(1); // footnote anchor on page 1

    const anchors = [fnAnchor("b4", "fn4")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    // Page 0 (before the footnote page) is the SAME object — copied through.
    expect(out.entries[0]).toBe(rawPlan.entries[0]);
    // Page 1 carries the footnote.
    expect(out.entries[1].footnoteContentBlockIds).toEqual(["fn4" as BlockId]);
    expect(out.entries[1].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);

    // blockOffset running-sum geometry (cursor-to-page resolution depends on
    // this accumulation). FN_PAGE: pageBlockSize 64 + pageGap 20 ⇒ each page
    // advances the running document-y by 84.
    //   page 0 (copied through): keeps its raw blockOffset of 0.
    //   page 1 (first footnote page, swept): 0 + 64 + 20 = 84.
    // The 29px slot on page 1 leaves 35px ⇒ only b4,b5 fit; b6,b7 are evicted to
    // a NEW page 2, created by the sweep.
    //   page 2 (eviction-created): 84 + 64 + 20 = 168.
    const pageAdvance = FN_PAGE.pageBlockSize + FN_PAGE.pageGap; // 84
    expect(out.entries[0].blockOffset).toBe(0);
    expect(out.entries[1].blockOffset).toBe(pageAdvance); // 84
    expect(out.entries.length).toBe(3);
    expect(out.entries[1].children.length).toBe(2); // slot evicted b6,b7
    expect(out.entries[2].startIndex).toBe(6); // b6 begins page 2
    expect(out.entries[2].blockOffset).toBe(2 * pageAdvance); // 168
  });

  it("a footnote that does NOT evict (small page reduction) keeps the same boundaries", () => {
    // 2 paras (32px) on a 64px page + a 1-line footnote (29px slot) ⇒ 35px body
    // area ⇒ both paras (32px) still fit. No eviction; single page; slot set.
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fn0", fnBody("fn0", 1)]]));

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, pageConfig,
    );

    expect(out.entries.length).toBe(1);
    expect(out.entries[0].children.length).toBe(2);
    expect(out.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
  });

  it("uses IMPLICIT_SECTION_PLAN cleanly (no section caps interfere)", () => {
    // Sanity: a section-less doc threaded with IMPLICIT_SECTION_PLAN behaves.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const rawPlan = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
    const bodies = new Map<BlockId, ElementBox>([
      ["fn0" as BlockId, fnCascade(fnBody("fn0", 1))],
    ]);

    const out = resolveFootnotes(
      rawPlan, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      bodies, [fnAnchor("b0", "fn0")], ctx, FN_SHAPER, undefined, FN_PAGE,
    );

    expect(out.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    expect(out.entries[0].children.length).toBe(2);
  });
});

// ===========================================================================
// FN-4.4 — resolveFootnotes incremental carry-forward (`prevResolvedPlan`). A
// swept page whose body inputs + assigned-body refs + geometry are all unchanged
// REUSES its prior resolution — skipping the footnote-body re-layout (the
// `bodyHeight` `layoutBlock` call, counted by the probe) AND the convergence
// loop. These pin BOTH the skip (call-count probe) AND that the reused page's
// geometry equals a fresh full build (CLAUDE.md — geometry, not just the count).
// ===========================================================================

/**
 * Re-cascade `nextRender` incrementally against the prior `(prevRender,
 * prevCascaded)` so unchanged blocks keep their cascaded ElementBox refs — the
 * carry-forward's ref-equality proof needs this. Returns the new cascaded root.
 */
function reCascade(
  nextRender: ElementBox,
  prevRender: ElementBox,
  prevCascaded: ElementBox,
): ElementBox {
  const c = cascadePassIncremental(nextRender, prevRender, prevCascaded);
  if (c.type !== "element") throw new Error("cascadePassIncremental returned non-element");
  return c;
}

/** Build the resolveFootnotes inputs (raw plan etc.) from a cascaded root. */
function inputsFrom(cascaded: ElementBox): {
  rawPlan: PagePlan;
  metas: ReturnType<typeof buildBlockFitMetas>;
  sectionPlan: ReturnType<typeof buildSectionPlan>;
  rootChildren: ElementBox[];
} {
  const metas = buildBlockFitMetas(cascaded, FN_SHAPER, FN_CONTENT_INLINE);
  const sectionPlan = buildSectionPlan(cascaded, FN_PAGE);
  const rootChildren = flattenContents(cascaded.children) as ElementBox[];
  const rawPlan = measurePass(metas, FN_PAGE, sectionPlan, rootChildren);
  return { rawPlan, metas, sectionPlan, rootChildren };
}

describe("resolveFootnotes — FN-4.4 incremental carry-forward (prevResolvedPlan)", () => {
  const fnCtx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);

  it("an edit on a footnote-FREE page does NOT re-lay-out the footnote pages' bodies; the footnote page's geometry stays correct (equals a fresh full build)", () => {
    // 8 paras; a footnote on b0 (page 0). Slot 29px ⇒ page 0 holds b0,b1; the
    // rest spill to footnote-FREE pages. We then edit b7 (last block, on a later
    // footnote-free page) — page 0's body inputs (startIndex 0, resumeInto null,
    // children [b0,b1]) and the fn0 body are all unchanged, so resolveFootnotes
    // must REUSE page 0's resolution, skipping the fn0 body re-layout.
    const render0 = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"), fnPara("b6"), fnPara("b7"),
    ]);
    const cascaded0 = fnCascade(render0);
    const inputs0 = inputsFrom(cascaded0);
    const fn0Body = fnCascade(fnBody("fn0", 1));
    const embed = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0Body]]);
    const anchors = [fnAnchor("b0", "fn0")];

    // Cycle 1: fresh resolve (no prevResolvedPlan). fn0's body IS laid out.
    __resetBodyLayoutCallCountForTest();
    const resolved0 = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    const cycle1BodyLayouts = __getBodyLayoutCallCountForTest();
    expect(cycle1BodyLayouts).toBeGreaterThan(0); // fn0 body was laid out
    // Page 0 carries the footnote with the expected geometry.
    expect(resolved0.entries[0].footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(resolved0.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    expect(resolved0.entries[0].children.length).toBe(2);

    // Cycle 2: edit b7 (a footnote-FREE block on a later page). Re-cascade
    // incrementally so b0..b6 + the fn0 body keep their refs.
    const render1 = fnDoc([
      ...render0.children.slice(0, 7),
      fnPara("b7", "EDITED"),
    ]);
    const cascaded1 = reCascade(render1, render0, cascaded0);
    const inputs1 = inputsFrom(cascaded1);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      inputs1.rawPlan, inputs1.metas, inputs1.sectionPlan, inputs1.rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
      // prevResolvedPlan + prior embed map (same map ref ⇒ fn0 body unchanged).
      resolved0, embed,
    );
    const cycle2BodyLayouts = __getBodyLayoutCallCountForTest();

    // THE SKIP: page 0's footnote body was NOT re-laid-out (the edit was on a
    // footnote-free page; the only footnote page is reused). 0 body layouts.
    expect(cycle2BodyLayouts).toBe(0);

    // GEOMETRY CORRECTNESS: a fresh full build of cycle-2's doc (no prev plan)
    // must agree with the incremental resolve on the footnote page's geometry —
    // the skip left no stale/misplaced slot.
    const resolvedFresh = resolveFootnotes(
      inputs1.rawPlan, inputs1.metas, inputs1.sectionPlan, inputs1.rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    expect(resolvedIncremental.entries[0].footnoteSlotHeight).toBe(
      resolvedFresh.entries[0].footnoteSlotHeight,
    );
    expect(resolvedIncremental.entries[0].footnoteContentBlockIds).toEqual(
      resolvedFresh.entries[0].footnoteContentBlockIds,
    );
    expect(resolvedIncremental.entries[0].children.map((c) => c.key)).toEqual(
      resolvedFresh.entries[0].children.map((c) => c.key),
    );
    expect(resolvedIncremental.entries[0].startIndex).toBe(resolvedFresh.entries[0].startIndex);
    expect(resolvedIncremental.entries[0].blockOffset).toBe(resolvedFresh.entries[0].blockOffset);

    // And the PageBox slot geometry (via getPage) is right after the skip: drive
    // the SAME incremental edit through the producer (which threads prevTree into
    // resolveFootnotes) and compare page 0's footnoteSlot against a fresh-built
    // tree of the edited doc. The skip must leave the slot at the right offset +
    // height (not stale/misplaced). The producer re-cascades footnote bodies
    // itself, so we pass the embed map keyed by the body root id.
    const treeA = buildVirtualPaginatedTree(
      cascaded0, fnCtx, FN_SHAPER, FN_PAGE, undefined, new Map(), embed, anchors,
    );
    treeA.getPage(0); // materialize so the carry-forward has a candidate
    const treeIncremental = buildVirtualPaginatedTree(
      cascaded1, fnCtx, FN_SHAPER, FN_PAGE, treeA, new Map(), embed, anchors,
    );
    const treeFresh = buildVirtualPaginatedTree(
      cascaded1, fnCtx, FN_SHAPER, FN_PAGE, undefined, new Map(), embed, anchors,
    );
    const slotInc = treeIncremental.getPage(0).footnoteSlot;
    const slotFresh = treeFresh.getPage(0).footnoteSlot;
    expect(slotInc).not.toBeNull();
    expect(slotFresh).not.toBeNull();
    if (slotInc === null || slotFresh === null) throw new Error("unreachable");
    expect(slotInc.blockOffset).toBe(slotFresh.blockOffset);
    expect(slotInc.blockSize).toBe(slotFresh.blockSize);
    // Concrete numbers: slot at pageBlockSize − bottomInset − slotHeight =
    // 64 − 0 − 29 = 35, height 29 (1-line body + separator).
    expect(slotInc.blockOffset).toBe(64 - (16 + FOOTNOTE_SEPARATOR_HEIGHT));
    expect(slotInc.blockSize).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
  });

  it("a change to a footnote body DOES re-resolve that page (cache miss) and the new slot height is reflected", () => {
    // Same 8-para doc + footnote on b0. Cycle 2 edits the fn0 BODY (1 line → 2
    // lines): the assigned-body ref flips, so page 0 must NOT reuse — it
    // re-resolves and the slot grows from 29 to 45.
    const render0 = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"), fnPara("b6"), fnPara("b7"),
    ]);
    const cascaded0 = fnCascade(render0);
    const inputs0 = inputsFrom(cascaded0);
    const fn0BodyA = fnCascade(fnBody("fn0", 1));
    const embedA = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0BodyA]]);
    const anchors = [fnAnchor("b0", "fn0")];

    const resolved0 = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embedA, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    expect(resolved0.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    // Cycle 2: doc UNCHANGED (same cascaded root reused), but the fn0 body is
    // re-cascaded to 2 lines (a NEW ElementBox ref for the same id).
    const fn0BodyB = fnCascade(fnBody("fn0", 2));
    expect(fn0BodyB).not.toBe(fn0BodyA);
    const embedB = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0BodyB]]);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
      resolved0, embedA, // prior plan + prior (1-line) body map
    );
    // MISS: the body ref differs ⇒ page 0 re-resolves ⇒ the body IS laid out.
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);
    // The new slot reflects the 2-line body: 2×16 + separator = 45.
    expect(resolvedIncremental.entries[0].footnoteSlotHeight).toBe(16 + 16 + FOOTNOTE_SEPARATOR_HEIGHT);

    // Equals a fresh full build of the edited-body doc.
    const resolvedFresh = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    expect(resolvedIncremental.entries[0].footnoteSlotHeight).toBe(
      resolvedFresh.entries[0].footnoteSlotHeight,
    );
  });

  it("footnote-free doc: prevResolvedPlan path is a no-op (early return still fires, ref-equal rawPlan out)", () => {
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const cascaded = fnCascade(render);
    const inputs = inputsFrom(cascaded);

    // A bogus prior plan should never be consulted — the no-anchors early return
    // fires first, returning the rawPlan by reference.
    const out = resolveFootnotes(
      inputs.rawPlan, inputs.metas, inputs.sectionPlan, inputs.rootChildren,
      new Map(), [], fnCtx, FN_SHAPER, undefined, FN_PAGE,
      inputs.rawPlan, new Map(),
    );
    expect(out).toBe(inputs.rawPlan);
  });

  it("a SECTION_BREAK that moves the cap into a footnote page's range INVALIDATES reuse (cache miss) and the re-resolved entry carries the CURRENT cap, not the stale prior one", () => {
    // The reuse gate must verify the SECTION CAP, not only geometry/refs/bodies.
    // Construct a 2-cycle scenario where ONLY the section cap changes for the
    // footnote page:
    //   doc = [b0, b1, b2, b3]; footnote fn0 on b0 (page 0). FN_PAGE is 64px ⇒
    //   the 29px slot leaves 35px ⇒ 2 paras would fit, BUT the section cap bounds
    //   the page first.
    //   Cycle 1: IMPLICIT plan ⇒ no cap ⇒ page 0's stopBeforeIndex is null.
    //   Cycle 2: a section boundary at index 1 ⇒ sectionStateAt(plan2, 0)
    //   .nextBoundaryIndex === 1 ⇒ page 0 must cap at 1 (only b0). Body refs +
    //   geometry are IDENTICAL across cycles (same cascaded doc, same fn0 body,
    //   same FN_PAGE), so EVERY other gate field matches — the cap is the ONLY
    //   change. A gate that ignores the cap would REUSE page 0 and emit the stale
    //   null cap, leaking b1 (next-section block) onto page 0.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    // Doc is UNCHANGED across cycles — only the sectionPlan differs — so the same
    // cascaded root / rootChildren / metas (hence ref-equal children + bodies).
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const fn0Body = fnCascade(fnBody("fn0", 1));
    const embed = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0Body]]);
    const anchors = [fnAnchor("b0", "fn0")];

    // --- Cycle 1: IMPLICIT plan (no cap). Page 0 = [b0, b1], stopBeforeIndex null.
    const rawPlan1 = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren);
    const resolved1 = resolveFootnotes(
      rawPlan1, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    expect(resolved1.entries[0].footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(resolved1.entries[0].stopBeforeIndex).toBeNull(); // no cap in cycle 1
    expect(resolved1.entries[0].children.map((c) => c.key)).toEqual(["b0", "b1"]);

    // --- Cycle 2: a section boundary at index 1 (b1 begins a new section). Built
    // directly (the SECTION_BREAK op would be heavy to drive through measurePass
    // here) so cycle 2's sectionStateAt yields nextBoundaryIndex === 1 at index 0.
    const plan2: SectionPlan = {
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "sec1" as BlockId },
      ],
    };
    // Sanity: the cap at the footnote page's startIndex (0) is now 1, NOT null.
    expect(sectionStateAt(plan2, 0).nextBoundaryIndex).toBe(1);
    expect(resolved1.entries[0].stopBeforeIndex).not.toBe(
      sectionStateAt(plan2, 0).nextBoundaryIndex,
    );

    const rawPlan2 = measurePass(metas, FN_PAGE, plan2, rootChildren);

    // Incremental resolve with the PRIOR plan + the SAME embed map (body refs
    // unchanged). The cap moved, so reuse MUST be refused.
    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      rawPlan2, metas, plan2, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
      resolved1, embed, // prior plan + prior body map (same refs)
    );

    // CACHE MISS: the footnote page (page 0) was RE-RESOLVED, not reused — its
    // body was re-laid-out (the body-layout probe climbed above 0). A gate that
    // ignored the cap would have reused page 0 (0 body layouts) and emitted the
    // stale null cap.
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);

    // The re-resolved entry carries the CURRENT cap (1), not the stale null, and
    // only b0 (the cap excludes b1, the next-section block, from page 0).
    expect(resolvedIncremental.entries[0].stopBeforeIndex).toBe(1);
    expect(resolvedIncremental.entries[0].children.map((c) => c.key)).toEqual(["b0"]);
    expect(resolvedIncremental.entries[0].footnoteContentBlockIds).toEqual(["fn0" as BlockId]);

    // GEOMETRY CORRECTNESS: the incremental result equals a fresh full build of
    // cycle 2's doc (no prev plan) on the footnote page — the cap-aware miss left
    // no stale slot/boundary.
    const resolvedFresh = resolveFootnotes(
      rawPlan2, metas, plan2, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, FN_PAGE,
    );
    expect(resolvedIncremental.entries[0].stopBeforeIndex).toBe(
      resolvedFresh.entries[0].stopBeforeIndex,
    );
    expect(resolvedIncremental.entries[0].children.map((c) => c.key)).toEqual(
      resolvedFresh.entries[0].children.map((c) => c.key),
    );
    expect(resolvedIncremental.entries[0].footnoteSlotHeight).toBe(
      resolvedFresh.entries[0].footnoteSlotHeight,
    );
    expect(resolvedIncremental.entries[0].blockOffset).toBe(
      resolvedFresh.entries[0].blockOffset,
    );
  });
});
