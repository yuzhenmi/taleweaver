import { describe, it, expect } from "vitest";
import type { ElementBox, RenderNode } from "../render/render-node";
import { createElementBox, createTextBox } from "../render/render-node";
import type { Style } from "../styles";
import type { BlockId } from "../state";
import type { FootnoteAnchorRef } from "../footnotes";
import { measurePass, type PagePlan } from "./measure-pass";
import { buildBlockFitMetas } from "./build-fit-metas";
import { buildSectionPlan, IMPLICIT_SECTION_PLAN } from "./section-plan";
import { flattenContents } from "./group-children";
import { cascadePass } from "../cascade";
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
} from "./resolve-footnotes";

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
  return { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx };
}

describe("resolveFootnotes", () => {
  it("(a) no anchors → returns the rawPlan by reference (no-op)", () => {
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map());

    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, [], ctx, FN_SHAPER,
    );

    expect(out).toBe(rawPlan); // ref-equal no-op
  });

  it("(b) all anchors skipped (nested, non-top-level) → ref-equal rawPlan (prod skip)", () => {
    const render = fnDoc([fnPara("b0")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
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
        cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([["fn0", fnBody("fn0", 1)]]));

    // RAW: single page, all 4 blocks.
    expect(rawPlan.entries.length).toBe(1);
    expect(rawPlan.entries[0].children.length).toBe(4);

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([
        ["fnA", fnBody("fnA", 1)],
        ["fnB", fnBody("fnB", 1)],
      ]), TALL);

    const anchors = [fnAnchor("b0", "fnA"), fnAnchor("b1", "fnB")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([["fn3", fnBody("fn3", 1)]]));

    expect(rawPlan.pageIndexOfBlock("b3")).toBe(0); // raw: b3 on page 0

    const anchors = [fnAnchor("b3", "fn3")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([["fnBig", fnBody("fnBig", 10)]]));

    const anchors = [fnAnchor("b0", "fnBig")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([["fn4", fnBody("fn4", 1)]]));

    expect(rawPlan.entries.length).toBe(2);
    expect(rawPlan.pageIndexOfBlock("b4")).toBe(1); // footnote anchor on page 1

    const anchors = [fnAnchor("b4", "fn4")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx } =
      setup(render, new Map([["fn0", fnBody("fn0", 1)]]));

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER,
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
      bodies, [fnAnchor("b0", "fn0")], ctx, FN_SHAPER,
    );

    expect(out.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    expect(out.entries[0].children.length).toBe(2);
  });
});
