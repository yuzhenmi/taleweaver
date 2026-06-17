import { describe, it, expect } from "vitest";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import {
  measurePass,
  buildPagePlan,
  type PagePlan,
  type PagePlanEntry,
  type SlotInsets,
} from "./measure-pass";
import { buildBlockFitMetas } from "./build-fit-metas";
import {
  buildSectionPlan,
  IMPLICIT_SECTION_PLAN,
  sectionStateAt,
  type SectionPlan,
} from "./section-plan";
import { flattenContents } from "./group-children";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { layoutBlock } from "./bfc";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";
import {
  buildBlockToTopLevelIndex,
  buildFootnotePageAssignment,
  footnoteAnchorPageAssignment,
  resolveFootnotes,
  computeSlotLayout,
  FOOTNOTE_SEPARATOR_HEIGHT,
  MIN_BODY_BLOCK_SIZE,
  __getBodyLayoutCallCountForTest,
  __resetBodyLayoutCallCountForTest,
} from "./resolve-footnotes";
import type { FootnoteContinuation } from "./measure-pass";
import type { BreakToken } from "./fragmentation";
import { buildVirtualPaginatedTree } from "./virtual-producer";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
// FN-6.4 slice 1 — footnoteAnchorPageAssignment: the per-anchor INVERSE of
// buildFootnotePageAssignment (contentBlockId → pageIndex). Same anchor→page
// source of truth (pageSpanOfBlock(...).first), just flattened. This is the
// `footnoteNumbers` `pageAssignment` shape restart-per-page consumes (FN-6.1).
// ===========================================================================

describe("footnoteAnchorPageAssignment (FN-6.4 slice 1)", () => {
  it("maps each footnote body to its anchor's page (different pages)", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 1, last: 1 },
    });
    const anchors = [anchor("b0", "fn0"), anchor("b1", "fn1")];

    const result = footnoteAnchorPageAssignment(anchors, plan, index);

    expect(result.get("fn0" as BlockId)).toBe(0);
    expect(result.get("fn1" as BlockId)).toBe(1);
    expect(result.size).toBe(2);
  });

  it("maps two same-page footnotes both to that page", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 0, last: 0 },
    });
    const anchors = [anchor("b0", "fnA"), anchor("b1", "fnB")];

    const result = footnoteAnchorPageAssignment(anchors, plan, index);

    expect(result.get("fnA" as BlockId)).toBe(0);
    expect(result.get("fnB" as BlockId)).toBe(0);
  });

  it("uses the FIRST page of a page-spanning anchor's block (D4)", () => {
    const children: ElementBox[] = [elem("bSpan")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({ bSpan: { first: 2, last: 4 } });
    const anchors = [anchor("bSpan", "fnSpan")];

    const result = footnoteAnchorPageAssignment(anchors, plan, index);

    expect(result.get("fnSpan" as BlockId)).toBe(2);
  });

  it("returns an empty map for empty anchors (no crash)", () => {
    const index = buildBlockToTopLevelIndex([elem("b0")]);
    const plan = stubPlan({ b0: { first: 0, last: 0 } });

    const result = footnoteAnchorPageAssignment([], plan, index);

    expect(result.size).toBe(0);
  });

  it("is exactly buildFootnotePageAssignment's grouping inverted (same source of truth)", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1"), elem("b2")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 0, last: 0 },
      b2: { first: 1, last: 1 },
    });
    const anchors = [
      anchor("b0", "fn0"),
      anchor("b1", "fn1"),
      anchor("b2", "fn2"),
    ];

    const byPage = buildFootnotePageAssignment(anchors, plan, index);
    const inverse = footnoteAnchorPageAssignment(anchors, plan, index);

    // Every (page → ids) entry round-trips to (id → page).
    let total = 0;
    for (const [page, ids] of byPage) {
      for (const id of ids) {
        expect(inverse.get(id)).toBe(page);
        total += 1;
      }
    }
    // No extra keys in the inverse beyond what the grouping produced.
    expect(inverse.size).toBe(total);
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
  const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
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
      cascadedEmbedContents, [], ctx, FN_SHAPER, undefined, undefined, pageConfig,
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
        cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
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
    expect(nth(rawPlan.entries, 0, "entries").children.length).toBe(4);

    const anchors = [fnAnchor("b0", "fn0")];
    __resetBodyLayoutCallCountForTest();
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );
    // F5 perf lock: the page's single footnote body is laid out EXACTLY ONCE — the
    // convergence loop's one iteration. The dev `footnoteSlotHeight` invariant does
    // NOT re-lay-out the body on this converged page (it skips the redundant
    // `slotLayoutFor` because `contentBlockIds` is unchanged since the slot was
    // computed). A regression that re-ran it unconditionally would make this 2.
    expect(__getBodyLayoutCallCountForTest()).toBe(1);

    expect(out).not.toBe(rawPlan);
    // Page 0 carries the footnote: slot = 1 line (16) + separator (13) = 29.
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    // The reduced space evicts blocks: page 0 now holds FEWER than the raw 4.
    expect(nth(out.entries, 0, "entries").children.length).toBeLessThan(4);
    // Specifically 35px / 16px ⇒ 2 paras on page 0.
    expect(nth(out.entries, 0, "entries").children.length).toBe(2);
    // Evicted blocks shifted to a new page whose startIndex moved past page 0.
    expect(out.entries.length).toBeGreaterThan(1);
    expect(nth(out.entries, 1, "entries").startIndex).toBe(2);
    expect(nth(out.entries, 1, "entries").footnoteSlotHeight).toBe(0); // page 1 has no footnote
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
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Two 1-line bodies (16 each) + ONE separator (13) = 45.
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual([
      "fnA" as BlockId,
      "fnB" as BlockId,
    ]);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(16 + 16 + FOOTNOTE_SEPARATOR_HEIGHT);
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
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // After convergence: b3 ended up on a later page; the footnote slot is on
    // whatever page actually carries b3 (NOT page 0, which b3 left).
    const b3Page = out.pageIndexOfBlock("b3");
    expect(b3Page).toBeGreaterThan(0);
    expect(nth(out.entries, b3Page, "entries").footnoteContentBlockIds).toEqual(["fn3" as BlockId]);
    expect(nth(out.entries, b3Page, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    // Pages that lost the footnote during convergence carry NO slot.
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual([]);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(0);
  });

  it("(f) FN-5 split (was D5 clamp): a body taller than the bounded area SPLITS — what fits is placed, the rest carries to a continuation page", () => {
    // A 10-block body (160px) on a 64px-content page can't fully fit. FN-5
    // REPLACES FN-4's D5 clamp with real splitting: the slot is bounded to
    // `pageContentBlockSize − MIN_BODY_BLOCK_SIZE − FOOTNOTE_SEPARATOR_HEIGHT`
    // (64 − 16 − 13 = 35) ⇒ 2 of the 10 blocks (32px) fit + the separator = 45px
    // slot; the remaining 8 blocks carry forward to a continuation page. (`fnBody`
    // is a CONTAINER of 10 block paragraphs, so it splits at block boundaries —
    // no orphans/widows override needed for block-level fragmentation.)
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setup(render, new Map([["fnBig", fnBody("fnBig", 10)]]));

    const anchors = [fnAnchor("b0", "fnBig")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Slot = 2 placed blocks (32) + separator (13) = 45 (NOT the FN-4 clamp of
    // 48, and NOT the raw 160 + 13 — the body SPLIT).
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(2 * 16 + FOOTNOTE_SEPARATOR_HEIGHT); // 45
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBeLessThan(16 * 10 + FOOTNOTE_SEPARATOR_HEIGHT);
    // fnBig STARTED on page 0; its remainder carries forward (a continuation page
    // exists) so the body is never clamped/lost.
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fnBig" as BlockId]);
    expect(out.entries.length).toBeGreaterThan(1);
    expect(nth(out.entries, 1, "entries").footnoteContinuation).toHaveLength(1);
    expect(nth(nth(out.entries, 1, "entries").footnoteContinuation, 0, "footnoteContinuation").contentBlockId).toBe("fnBig");
    // The page stays valid: the body content area retains ≥ MIN_BODY (≥1 line),
    // so at least one block still fits on page 0.
    expect(nth(out.entries, 0, "entries").children.length).toBeGreaterThanOrEqual(1);
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
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Page 0 (before the footnote page) is the SAME object — copied through.
    expect(nth(out.entries, 0, "entries")).toBe(nth(rawPlan.entries, 0, "entries"));
    // Page 1 carries the footnote.
    expect(nth(out.entries, 1, "entries").footnoteContentBlockIds).toEqual(["fn4" as BlockId]);
    expect(nth(out.entries, 1, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);

    // blockOffset running-sum geometry (cursor-to-page resolution depends on
    // this accumulation). FN_PAGE: pageBlockSize 64 + pageGap 20 ⇒ each page
    // advances the running document-y by 84.
    //   page 0 (copied through): keeps its raw blockOffset of 0.
    //   page 1 (first footnote page, swept): 0 + 64 + 20 = 84.
    // The 29px slot on page 1 leaves 35px ⇒ only b4,b5 fit; b6,b7 are evicted to
    // a NEW page 2, created by the sweep.
    //   page 2 (eviction-created): 84 + 64 + 20 = 168.
    const pageAdvance = FN_PAGE.pageBlockSize + FN_PAGE.pageGap; // 84
    expect(nth(out.entries, 0, "entries").blockOffset).toBe(0);
    expect(nth(out.entries, 1, "entries").blockOffset).toBe(pageAdvance); // 84
    expect(out.entries.length).toBe(3);
    expect(nth(out.entries, 1, "entries").children.length).toBe(2); // slot evicted b6,b7
    expect(nth(out.entries, 2, "entries").startIndex).toBe(6); // b6 begins page 2
    expect(nth(out.entries, 2, "entries").blockOffset).toBe(2 * pageAdvance); // 168
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
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    expect(out.entries.length).toBe(1);
    expect(nth(out.entries, 0, "entries").children.length).toBe(2);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
  });

  it("uses IMPLICIT_SECTION_PLAN cleanly (no section caps interfere)", () => {
    // Sanity: a section-less doc threaded with IMPLICIT_SECTION_PLAN behaves.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const rawPlan = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
    const bodies = new Map<BlockId, ElementBox>([
      ["fn0" as BlockId, fnCascade(fnBody("fn0", 1))],
    ]);

    const out = resolveFootnotes(
      rawPlan, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      bodies, [fnAnchor("b0", "fn0")], ctx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );

    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    expect(nth(out.entries, 0, "entries").children.length).toBe(2);
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
  const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
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
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    const cycle1BodyLayouts = __getBodyLayoutCallCountForTest();
    expect(cycle1BodyLayouts).toBeGreaterThan(0); // fn0 body was laid out
    // Page 0 carries the footnote with the expected geometry.
    expect(nth(resolved0.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(nth(resolved0.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
    expect(nth(resolved0.entries, 0, "entries").children.length).toBe(2);

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
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
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
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteSlotHeight).toBe(
      nth(resolvedFresh.entries, 0, "entries").footnoteSlotHeight,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteContentBlockIds).toEqual(
      nth(resolvedFresh.entries, 0, "entries").footnoteContentBlockIds,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").children.map((c) => c.key)).toEqual(
      nth(resolvedFresh.entries, 0, "entries").children.map((c) => c.key),
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").startIndex).toBe(nth(resolvedFresh.entries, 0, "entries").startIndex);
    expect(nth(resolvedIncremental.entries, 0, "entries").blockOffset).toBe(nth(resolvedFresh.entries, 0, "entries").blockOffset);

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
      embedA, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolved0.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    // Cycle 2: doc UNCHANGED (same cascaded root reused), but the fn0 body is
    // re-cascaded to 2 lines (a NEW ElementBox ref for the same id).
    const fn0BodyB = fnCascade(fnBody("fn0", 2));
    expect(fn0BodyB).not.toBe(fn0BodyA);
    const embedB = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0BodyB]]);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
      resolved0, embedA, // prior plan + prior (1-line) body map
    );
    // MISS: the body ref differs ⇒ page 0 re-resolves ⇒ the body IS laid out.
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);
    // The new slot reflects the 2-line body: 2×16 + separator = 45.
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteSlotHeight).toBe(16 + 16 + FOOTNOTE_SEPARATOR_HEIGHT);

    // Equals a fresh full build of the edited-body doc.
    const resolvedFresh = resolveFootnotes(
      inputs0.rawPlan, inputs0.metas, inputs0.sectionPlan, inputs0.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteSlotHeight).toBe(
      nth(resolvedFresh.entries, 0, "entries").footnoteSlotHeight,
    );
  });

  it("carry-forward over a SELF-EVICTING doc stays correct across a body edit — the atomic-cap page is never stale-reused (footnotes-audit F3 soundness lock)", () => {
    // F3 (audited 2026-06-10, verdict: FALSE POSITIVE). The auditor feared
    // `canReuseFootnotePage` could reuse a page whose self-eviction 2-cycle would
    // now resolve differently. Verification showed it cannot: whether an anchor
    // self-evicts is a PURE function of the gated inputs — preceding-block geometry
    // (cond 4), page geometry (cond 3), and the section cap (cond 0). A footnote
    // BODY edit (cond 5's domain) only changes how the slot SPLITS, never WHETHER
    // the anchor evicts; and an atomic-cap page's `stopBeforeIndex` (< the section
    // cap) makes cond 0 ALWAYS refuse its reuse (the documented conservative miss).
    // This test drives a doc that genuinely self-evicts (test (e) geometry) through
    // the carry-forward path with a body edit and pins the carried-forward result
    // to a fresh full build — the equivalence oracle catches ANY stale-reuse leak.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const inputs = inputsFrom(cascaded);
    const anchors = [fnAnchor("b3", "fn3")];

    // Cycle 1: 2-line body. b3 self-evicts (the 4 blocks + any slot overflow the
    // 64px page), so b3 + fn3 travel forward together; page 0 carries no slot and
    // is atomic-capped before b3.
    const bodyA = fnCascade(fnBody("fn3", 2));
    const embedA = new Map<BlockId, ElementBox>([["fn3" as BlockId, bodyA]]);
    const resolved0 = resolveFootnotes(
      inputs.rawPlan, inputs.metas, inputs.sectionPlan, inputs.rootChildren,
      embedA, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(resolved0.pageIndexOfBlock("b3")).toBeGreaterThan(0); // b3 evicted
    expect(nth(resolved0.entries, 0, "entries").footnoteContentBlockIds).toEqual([]); // page 0: no slot
    // Page 0's cap is footnote-tightened below its natural fill (the atomic cap
    // before b3) — this is what forces cond 0 to re-resolve it every cycle.
    expect(nth(resolved0.entries, 0, "entries").stopBeforeIndex).not.toBeNull();

    // Cycle 2: the SAME doc, fn3 body grows 2 → 3 lines (NEW ref). The slot page
    // re-resolves via cond 5 (assigned-body ref flip); the atomic-cap page 0
    // re-resolves via cond 0 (tightened cap ≠ current null section cap).
    const bodyB = fnCascade(fnBody("fn3", 3));
    expect(bodyB).not.toBe(bodyA);
    const embedB = new Map<BlockId, ElementBox>([["fn3" as BlockId, bodyB]]);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      inputs.rawPlan, inputs.metas, inputs.sectionPlan, inputs.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
      resolved0, embedA, // prior plan + prior (2-line) body map
    );
    // Re-resolution happened (the body was laid out, not skipped).
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);
    // b3 stays evicted; page 0 still carries no slot — no stale non-evicting page leaked.
    expect(resolvedIncremental.pageIndexOfBlock("b3")).toBeGreaterThan(0);
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteContentBlockIds).toEqual([]);

    // EQUIVALENCE BACKSTOP: the carry-forward result matches a fresh full build of
    // the edited doc across EVERY page — page count, per-page child slices, the
    // footnote assignment, and the slot heights. This catches any stale-reuse of
    // the SLOT PAGE (page 1), whose slot height changes when the body grows. The
    // atomic-cap page (page 0) happens to produce identical output in both cycles
    // (its slot is 0 and its one-block fill is unchanged), so a stale reuse of
    // page 0 would NOT surface here — that case is covered by cond 0's analytical
    // guarantee in the gate (a footnote-tightened stopBeforeIndex never equals the
    // current section cap, so reuse is always refused) and by the call-count probe
    // above; the SECTION_BREAK test below independently exercises cond 0 directly.
    const resolvedFresh = resolveFootnotes(
      inputs.rawPlan, inputs.metas, inputs.sectionPlan, inputs.rootChildren,
      embedB, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(resolvedIncremental.entries.length).toBe(resolvedFresh.entries.length);
    expect(resolvedIncremental.pageIndexOfBlock("b3")).toBe(resolvedFresh.pageIndexOfBlock("b3"));
    expect(resolvedIncremental.entries.map((e) => e.children.map((c) => c.key))).toEqual(
      resolvedFresh.entries.map((e) => e.children.map((c) => c.key)),
    );
    expect(resolvedIncremental.entries.map((e) => e.footnoteContentBlockIds)).toEqual(
      resolvedFresh.entries.map((e) => e.footnoteContentBlockIds),
    );
    expect(resolvedIncremental.entries.map((e) => e.footnoteSlotHeight)).toEqual(
      resolvedFresh.entries.map((e) => e.footnoteSlotHeight),
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
      new Map(), [], fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
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
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const fn0Body = fnCascade(fnBody("fn0", 1));
    const embed = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0Body]]);
    const anchors = [fnAnchor("b0", "fn0")];

    // --- Cycle 1: IMPLICIT plan (no cap). Page 0 = [b0, b1], stopBeforeIndex null.
    const rawPlan1 = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren);
    const resolved1 = resolveFootnotes(
      rawPlan1, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolved1.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(nth(resolved1.entries, 0, "entries").stopBeforeIndex).toBeNull(); // no cap in cycle 1
    expect(nth(resolved1.entries, 0, "entries").children.map((c) => c.key)).toEqual(["b0", "b1"]);

    // --- Cycle 2: a section boundary at index 1 (b1 begins a new section). Built
    // directly (the SECTION_BREAK op would be heavy to drive through measurePass
    // here) so cycle 2's sectionStateAt yields nextBoundaryIndex === 1 at index 0.
    const plan2: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "sec1" as BlockId },
      ],
    };
    // Sanity: the cap at the footnote page's startIndex (0) is now 1, NOT null.
    expect(sectionStateAt(plan2, 0).nextBoundaryIndex).toBe(1);
    expect(nth(resolved1.entries, 0, "entries").stopBeforeIndex).not.toBe(
      sectionStateAt(plan2, 0).nextBoundaryIndex,
    );

    const rawPlan2 = measurePass(metas, FN_PAGE, plan2, rootChildren);

    // Incremental resolve with the PRIOR plan + the SAME embed map (body refs
    // unchanged). The cap moved, so reuse MUST be refused.
    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      rawPlan2, metas, plan2, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
      resolved1, embed, // prior plan + prior body map (same refs)
    );

    // CACHE MISS: the footnote page (page 0) was RE-RESOLVED, not reused — its
    // body was re-laid-out (the body-layout probe climbed above 0). A gate that
    // ignored the cap would have reused page 0 (0 body layouts) and emitted the
    // stale null cap.
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);

    // The re-resolved entry carries the CURRENT cap (1), not the stale null, and
    // only b0 (the cap excludes b1, the next-section block, from page 0).
    expect(nth(resolvedIncremental.entries, 0, "entries").stopBeforeIndex).toBe(1);
    expect(nth(resolvedIncremental.entries, 0, "entries").children.map((c) => c.key)).toEqual(["b0"]);
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);

    // GEOMETRY CORRECTNESS: the incremental result equals a fresh full build of
    // cycle 2's doc (no prev plan) on the footnote page — the cap-aware miss left
    // no stale slot/boundary.
    const resolvedFresh = resolveFootnotes(
      rawPlan2, metas, plan2, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").stopBeforeIndex).toBe(
      nth(resolvedFresh.entries, 0, "entries").stopBeforeIndex,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").children.map((c) => c.key)).toEqual(
      nth(resolvedFresh.entries, 0, "entries").children.map((c) => c.key),
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteSlotHeight).toBe(
      nth(resolvedFresh.entries, 0, "entries").footnoteSlotHeight,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").blockOffset).toBe(
      nth(resolvedFresh.entries, 0, "entries").blockOffset,
    );
  });

  it("a grown header/footer SLOT INSET (the §4.4 page-field convergence signal) INVALIDATES reuse (cond 3) — the footnote page re-resolves against the new geometry", () => {
    // This is the carry-forward gate's cond-3 (effective-inset geometry) lock, and
    // the mechanism that keeps the §4.4 page-field width-convergence loop sound:
    // `virtual-producer`'s `runIteration` passes the PRIOR KEYSTROKE's resolved
    // plan as `prevResolvedPlan` on EVERY convergence iteration (never iteration
    // N-1). That is correct precisely BECAUSE the gate is stateless across
    // iterations and compares the CURRENT iteration's `slotInsets`-derived
    // effTopInset/effBottomInset against the prior entry's — so when an iteration
    // grows a header page-field's slot, the taller inset busts cond 3 and forces a
    // correct re-resolve. (Footnotes-audit F1 verification: prevResolvedPlan being
    // pinned to the previous keystroke is sound, not a staleness bug.)
    //
    // doc = [b0, b1, b2, b3]; fn0 on b0 (page 0). FN_PAGE is 64px, zero margins.
    //   Cycle 1: no extra slot inset ⇒ 64px content ⇒ 29px footnote slot leaves
    //   35px ⇒ page 0 = [b0, b1].
    //   Cycle 2: a 16px TOP slot inset (a grown header) ⇒ 48px content ⇒ the same
    //   29px slot leaves 19px ⇒ page 0 = [b0] only. Doc + body refs + section cap
    //   are IDENTICAL across cycles — the inset is the ONLY change, so the gate's
    //   two executable pre-checks (cond 0 section cap, cond 2 resumeInto) both pass
    //   and it reaches cond 3, where it must refuse reuse.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const fn0Body = fnCascade(fnBody("fn0", 1));
    const embed = new Map<BlockId, ElementBox>([["fn0" as BlockId, fn0Body]]);
    const anchors = [fnAnchor("b0", "fn0")];

    // --- Cycle 1: no slot inset (effTopInset 0). Page 0 = [b0, b1].
    const rawPlan1 = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren);
    const resolved1 = resolveFootnotes(
      rawPlan1, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(nth(resolved1.entries, 0, "entries").effectiveTopInset).toBe(0);
    expect(nth(resolved1.entries, 0, "entries").children.map((c) => c.key)).toEqual(["b0", "b1"]);
    expect(nth(resolved1.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);

    // --- Cycle 2: a 16px top slot inset (a grown header from the §4.4 loop). Both
    // measurePass AND resolveFootnotes see it, so page 0's content area shrinks.
    const grownInsets: SlotInsets = new Map([[null, { top: 16, bottom: 0 }]]);
    const rawPlan2 = measurePass(metas, FN_PAGE, IMPLICIT_SECTION_PLAN, rootChildren, undefined, grownInsets);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      rawPlan2, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, grownInsets, FN_PAGE,
      resolved1, embed, // prior (cycle-1, inset-0) plan + same body refs
    );
    // CACHE MISS via cond 3: the effTopInset changed (0 → 16) ⇒ the footnote page
    // was RE-RESOLVED (body re-laid-out), not reused. A gate that ignored the inset
    // would have reused page 0's [b0, b1] slice against the now-smaller content area.
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);
    expect(nth(resolvedIncremental.entries, 0, "entries").effectiveTopInset).toBe(16);
    expect(nth(resolvedIncremental.entries, 0, "entries").children.map((c) => c.key)).toEqual(["b0"]);
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);

    // GEOMETRY CORRECTNESS: the inset-aware miss equals a fresh full build of the
    // cycle-2 geometry — no stale wider-content slice leaked through the gate.
    const resolvedFresh = resolveFootnotes(
      rawPlan2, metas, IMPLICIT_SECTION_PLAN, rootChildren,
      embed, anchors, fnCtx, FN_SHAPER, undefined, grownInsets, FN_PAGE,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").children.map((c) => c.key)).toEqual(
      nth(resolvedFresh.entries, 0, "entries").children.map((c) => c.key),
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").effectiveTopInset).toBe(
      nth(resolvedFresh.entries, 0, "entries").effectiveTopInset,
    );
    expect(nth(resolvedIncremental.entries, 0, "entries").footnoteSlotHeight).toBe(
      nth(resolvedFresh.entries, 0, "entries").footnoteSlotHeight,
    );
  });
});

// ===========================================================================
// FN-5.3: computeSlotLayout — greedy fill + split + carry-all-overflow.
//
// Geometry contract of the test fixtures below (mock shaper 8px/char, 16px
// line-height): each footnote body is ONE paragraph of `lines` single-glyph
// lines under `whiteSpace: "pre"` (hard `\n` breaks), so it lays out to exactly
// `lines * 16`px and splits at single-line granularity. `orphans: 1, widows: 1`
// on the body root (the footnote-body component default, FN-5.2 E2) lets the IFC
// place a single line + carry the rest — without it a 2-line body would refuse
// to split (box: null). Consts: FOOTNOTE_SEPARATOR_HEIGHT = 13,
// MIN_BODY_BLOCK_SIZE = 16, so `maxSlot = pageContentBlockSize − 16 − 13`.
// ===========================================================================

const SLOT_INLINE = 600;
const SLOT_LINE = 16;

/**
 * A splittable footnote body: ONE paragraph of `lines` lines (hard `\n` breaks
 * under `whiteSpace: "pre"`), with `orphans: 1, widows: 1` on the body root so
 * the IFC splits it at single-line boundaries (the FN-5.2 footnote-body
 * default). Cascaded, ready for `computeSlotLayout`'s `embedBodies` map.
 */
function splitBody(key: string, lines: number): ElementBox {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) parts.push("x");
  const text = parts.join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  const para = createElementBox(
    `${key}-p`,
    { display: "block", whiteSpace: "pre" } as Style,
    [textNode],
  );
  const root = createElementBox(
    key,
    { display: "block", whiteSpace: "break-spaces", orphans: 1, widows: 1 } as Style,
    [para],
  );
  return fnCascade(root);
}

/** A `computeSlotLayout` ctx mirroring `resolveFootnotes`'s root ctx. */
function slotCtx(): ReturnType<typeof makeRootContext> {
  return makeRootContext(INITIAL_COMPUTED_STYLE, SLOT_INLINE);
}

/**
 * Lay out a freshly-built body bounded by `available` (matching how
 * `computeSlotLayout` lays bodies) and return its non-null break token — used to
 * synthesize a realistic inbound `resumeToken` for the continuation-input cases.
 */
function partialToken(body: ElementBox, available: number): BreakToken {
  const ctx: ReturnType<typeof makeRootContext> = {
    ...slotCtx(),
    containingInlineSize: SLOT_INLINE,
  };
  const { breakToken } = layoutBlock(body, 0, 0, ctx, FN_SHAPER, undefined, {
    availableBlockSize: available,
    pageIndex: 0,
    resumeFrom: null,
  });
  if (breakToken === null) {
    throw new Error("partialToken: expected a non-null break token");
  }
  return breakToken;
}

describe("computeSlotLayout (FN-5.3)", () => {
  it("(a) two fresh bodies: first fits, second splits; both START, remainder carries", () => {
    const A = splitBody("A", 1); // 16px
    const B = splitBody("B", 3); // 48px
    const bodies = new Map<BlockId, ElementBox>([
      ["A" as BlockId, A],
      ["B" as BlockId, B],
    ]);
    // pageContentBlockSize = 77 → maxSlot = 77 − 16 − 13 = 48.
    // A places (16) → remaining 32 → B places 2 of 3 lines (32), 1 carries.
    const r = computeSlotLayout(
      [],
      ["A" as BlockId, "B" as BlockId],
      bodies,
      77,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 16 + 2 * SLOT_LINE); // 13+16+32 = 61
    expect(r.slotContentBlockIds).toEqual(["A", "B"]); // both STARTED here
    expect(r.outboundContinuations).toHaveLength(1);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").contentBlockId).toBe("B");
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBeNull();
  });

  it("(b) THREE fresh A,B,C: slot fits A + partial B; C is FULLY DEFERRED, not lost (Blocker-1)", () => {
    const A = splitBody("A", 1); // 16
    const B = splitBody("B", 3); // 48
    const C = splitBody("C", 1); // 16
    const bodies = new Map<BlockId, ElementBox>([
      ["A" as BlockId, A],
      ["B" as BlockId, B],
      ["C" as BlockId, C],
    ]);
    // maxSlot = 48: A(16) + Bpartial(32) consumes it; B overflows, C never tried.
    const r = computeSlotLayout(
      [],
      ["A" as BlockId, "B" as BlockId, "C" as BlockId],
      bodies,
      77,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 16 + 2 * SLOT_LINE); // 61
    expect(r.slotContentBlockIds).toEqual(["A", "B"]); // C did NOT start here
    // The Blocker-1 assertion: C is carried forward (deferred), NOT dropped.
    expect(r.outboundContinuations).toHaveLength(2);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").contentBlockId).toBe("B");
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBeNull();
    expect(nth(r.outboundContinuations, 1, "outboundContinuations").contentBlockId).toBe("C");
    expect(nth(r.outboundContinuations, 1, "outboundContinuations").resumeToken).toBeNull(); // fully deferred
  });

  it("(c) inbound list [{B,tokenB},{C,null}] renders first; only FRESH started bodies in slotContentBlockIds", () => {
    // B is a 3-line body already showing 2 lines on the prior page → 1 line left.
    const B = splitBody("B", 3);
    const tokenB = partialToken(B, 2 * SLOT_LINE); // resume after 2 lines (1 left)
    const C = splitBody("C", 1); // 16, never started → resumeToken null
    const D = splitBody("D", 1); // 16, this page's fresh body
    const bodies = new Map<BlockId, ElementBox>([
      ["B" as BlockId, B],
      ["C" as BlockId, C],
      ["D" as BlockId, D],
    ]);
    const inbound: FootnoteContinuation[] = [
      { contentBlockId: "B" as BlockId, resumeToken: tokenB },
      { contentBlockId: "C" as BlockId, resumeToken: null },
    ];
    // pageContentBlockSize = 200 → maxSlot = 171: B(16) + C(16) + D(16) all fit.
    const r = computeSlotLayout(
      inbound,
      ["D" as BlockId],
      bodies,
      200,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    // sep + B-remainder(16) + C(16) + D(16) = 13 + 48 = 61.
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 3 * SLOT_LINE);
    // Inbound B and C are NOT in slotContentBlockIds (they render via the inbound
    // list); only the fresh D, which STARTED here.
    expect(r.slotContentBlockIds).toEqual(["D"]);
    expect(r.outboundContinuations).toHaveLength(0);
  });

  it("(d) inbound that ALSO overflows → re-split; everything after defers", () => {
    // B is a 4-line body showing 1 line on the prior page → 3 lines (48) left.
    const B = splitBody("B", 4);
    const tokenB = partialToken(B, 1 * SLOT_LINE); // resume after 1 line (3 left)
    const C = splitBody("C", 1);
    const bodies = new Map<BlockId, ElementBox>([
      ["B" as BlockId, B],
      ["C" as BlockId, C],
    ]);
    const inbound: FootnoteContinuation[] = [
      { contentBlockId: "B" as BlockId, resumeToken: tokenB },
      { contentBlockId: "C" as BlockId, resumeToken: null },
    ];
    // pageContentBlockSize = 61 → maxSlot = 32: B re-splits (places 2 of its 3
    // remaining lines), C fully defers.
    const r = computeSlotLayout(
      inbound,
      [],
      bodies,
      61,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 2 * SLOT_LINE); // 13+32 = 45
    expect(r.slotContentBlockIds).toEqual([]); // no FRESH body started
    expect(r.outboundContinuations).toHaveLength(2);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").contentBlockId).toBe("B");
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBeNull(); // re-split token
    // The re-split token differs from the inbound token (advanced past more lines).
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBe(tokenB);
    expect(nth(r.outboundContinuations, 1, "outboundContinuations").contentBlockId).toBe("C");
    expect(nth(r.outboundContinuations, 1, "outboundContinuations").resumeToken).toBeNull();
  });

  it("(e) E3: area below one line → nothing placed, slotHeight 0, NO separator, all carry", () => {
    const A = splitBody("A", 2);
    const B = splitBody("B", 1);
    const bodies = new Map<BlockId, ElementBox>([
      ["A" as BlockId, A],
      ["B" as BlockId, B],
    ]);
    // pageContentBlockSize = 37 → maxSlot = 37 − 16 − 13 = 8 < one line (16).
    const r = computeSlotLayout(
      [],
      ["A" as BlockId, "B" as BlockId],
      bodies,
      37,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(0); // NO separator when nothing placed
    expect(r.slotContentBlockIds).toEqual([]);
    expect(r.outboundContinuations).toHaveLength(2);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations")).toEqual({
      contentBlockId: "A",
      resumeToken: null,
    });
    expect(nth(r.outboundContinuations, 1, "outboundContinuations")).toEqual({
      contentBlockId: "B",
      resumeToken: null,
    });
  });

  it("(f) a body taller than a whole empty area → outbound carries its remainder (chain seed)", () => {
    const A = splitBody("A", 5); // 80px
    const bodies = new Map<BlockId, ElementBox>([["A" as BlockId, A]]);
    // pageContentBlockSize = 61 → maxSlot = 32: A places 2 of 5 lines, 3 carry.
    const r = computeSlotLayout(
      [],
      ["A" as BlockId],
      bodies,
      61,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 2 * SLOT_LINE); // 45
    expect(r.slotContentBlockIds).toEqual(["A"]); // STARTED here
    expect(r.outboundContinuations).toHaveLength(1);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").contentBlockId).toBe("A");
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBeNull(); // remainder seeds the chain
  });

  it("(g) Blocker-2: one very tall fresh body — slot capped so the page body retains ≥ MIN_BODY_BLOCK_SIZE", () => {
    const A = splitBody("A", 100); // 1600px — far taller than the page
    const bodies = new Map<BlockId, ElementBox>([["A" as BlockId, A]]);
    const pageContentBlockSize = 200;
    // maxSlot = 200 − 16 − 13 = 171 → 10 lines (160) fit; slotHeight = 173.
    const r = computeSlotLayout(
      [],
      ["A" as BlockId],
      bodies,
      pageContentBlockSize,
      SLOT_INLINE,
      slotCtx(),
      FN_SHAPER, undefined
    );
    expect(r.slotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 10 * SLOT_LINE); // 173
    // Blocker-2: the page body keeps at least MIN_BODY_BLOCK_SIZE below the slot.
    expect(pageContentBlockSize - r.slotHeight).toBeGreaterThanOrEqual(
      MIN_BODY_BLOCK_SIZE,
    );
    expect(r.slotContentBlockIds).toEqual(["A"]);
    expect(r.outboundContinuations).toHaveLength(1);
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").contentBlockId).toBe("A");
    expect(nth(r.outboundContinuations, 0, "outboundContinuations").resumeToken).not.toBeNull();
  });
});

// ===========================================================================
// FN-5.4: thread the inbound/outbound continuation LIST through the forward
// sweep + the E6(a) reuse gate. These drive the REAL
// render→cascade→measurePass→resolveFootnotes flow with a SPLITTABLE footnote
// body (single paragraph, orphans/widows = 1 via `splitBody`), asserting the
// per-page `footnoteContinuation` list progression (contentBlockId +
// resumeAtLine advancing) and that the body's lines partition across the pages
// with no overlap or loss. `footnoteContentBlockIds` now means "fresh bodies
// STARTED on this page" (the FN-5 semantic change), so a deferred fresh body is
// in this page's `footnoteContinuation` outbound → the NEXT page's inbound, never
// in this page's `footnoteContentBlockIds`.
// ===========================================================================

/**
 * Descend a footnote-body break token to its inner IFC `resumeAtLine` (the
 * count of lines consumed on the prior page). A `splitBody` root is
 * `block(body) → block(para) → ifc`, so the token nests
 * `block → resumeChildToken block → resumeChildToken ifc`. Returns the deepest
 * `ifc` token's `resumeAtLine`, or `null` when the token is not an IFC chain.
 */
function resumeAtLineOf(token: BreakToken | null): number | null {
  let t: BreakToken | null = token;
  while (t !== null) {
    if (t.type === "ifc") return t.resumeAtLine;
    if (t.type === "block") {
      t = t.resumeChildToken;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Build the `resolveFootnotes` inputs from a render-doc root + cascaded
 * splittable footnote bodies (each via `splitBody`, so orphans/widows = 1).
 * Mirrors `setup` but cascades the bodies as splittable single-paragraph blocks.
 */
function setupSplit(
  renderRoot: ElementBox,
  bodies: ReadonlyMap<string, number>, // body id → line count
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
  const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
  const sectionPlan = buildSectionPlan(cascaded, pageConfig);
  const rootChildren = flattenContents(cascaded.children) as ElementBox[];
  const rawPlan = measurePass(metas, pageConfig, sectionPlan, rootChildren);

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, lines] of bodies) {
    // `splitBody` already cascades; it is keyed by `id` as the body root.
    cascadedEmbedContents.set(id as BlockId, splitBody(id, lines));
  }

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
  return { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig };
}

describe("resolveFootnotes — FN-5.4 forward-sweep continuation threading", () => {
  it("a footnote that fully FITS leaves footnoteContinuation empty (FN-4 single-page parity, no split)", () => {
    // 2 paras (32px) + a 1-line footnote (29px slot) on a 64px page: both paras
    // still fit, the body fully fits ⇒ no overflow ⇒ empty continuation list.
    const render = fnDoc([fnPara("b0"), fnPara("b1")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupSplit(render, new Map([["fn0", 1]]));

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    expect(out.entries.length).toBe(1);
    expect(nth(out.entries, 0, "entries").footnoteContinuation).toEqual([]); // inbound (none)
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0"]); // started + finished here
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);
  });

  it("a 3-page footnote chain: one body taller than two empty footnote areas partitions its lines across 3 pages with no overlap/loss", () => {
    // ONE footnote on b0 whose body is 12 lines (192px). The page is 64px content
    // ⇒ maxSlot per page = 64 − 16 − 13 = 35 ⇒ 2 lines (32px) fit per page. 12
    // lines / 2-per-page ⇒ the body spans pages 0, 1, 2 (2 + 2 + … ). We assert
    // the inbound `footnoteContinuation` resumeAtLine progression and that the
    // placed lines partition the 12 with no overlap or loss.
    const render = fnDoc([fnPara("b0")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupSplit(render, new Map([["fnBig", 12]]));

    const anchors = [fnAnchor("b0", "fnBig")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Page 0: inbound EMPTY (this page STARTS the body). It places 2 lines and
    // carries the rest. fnBig is "started here" so it is in this page's
    // footnoteContentBlockIds.
    expect(nth(out.entries, 0, "entries").footnoteContinuation).toEqual([]);
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fnBig"]);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 2 * 16); // 45

    // There must be ≥3 pages (the body cannot finish on fewer).
    expect(out.entries.length).toBeGreaterThanOrEqual(3);

    // Page 1: inbound list = [{fnBig, token@line2}] (renders the body's remainder
    // at top). fnBig is NOT freshly started here ⇒ NOT in footnoteContentBlockIds.
    const p1 = nth(out.entries, 1, "entries");
    expect(p1.footnoteContinuation).toHaveLength(1);
    expect(nth(p1.footnoteContinuation, 0, "footnoteContinuation").contentBlockId).toBe("fnBig");
    expect(resumeAtLineOf(nth(p1.footnoteContinuation, 0, "footnoteContinuation").resumeToken)).toBe(2);
    expect(p1.footnoteContentBlockIds).toEqual([]); // not freshly started here

    // Page 2: inbound resumeAtLine advanced to 4 (2 more consumed on page 1).
    const p2 = nth(out.entries, 2, "entries");
    expect(p2.footnoteContinuation).toHaveLength(1);
    expect(nth(p2.footnoteContinuation, 0, "footnoteContinuation").contentBlockId).toBe("fnBig");
    expect(resumeAtLineOf(nth(p2.footnoteContinuation, 0, "footnoteContinuation").resumeToken)).toBe(4);

    // The resumeAtLine sequence across the inbound lists is strictly increasing in
    // steps of 2 (2 lines per page), partitioning the 12 lines with no overlap.
    const resumePoints: number[] = [];
    for (const e of out.entries) {
      if (e.footnoteContinuation.length === 1 && nth(e.footnoteContinuation, 0, "footnoteContinuation").contentBlockId === "fnBig") {
        const r = resumeAtLineOf(nth(e.footnoteContinuation, 0, "footnoteContinuation").resumeToken);
        if (r !== null) resumePoints.push(r);
      }
    }
    // Inbound resume points are 2, 4, 6, 8, 10 (each page after page 0 resumes 2
    // further into the body) — strictly increasing, step 2, covering all 12 lines.
    for (let i = 1; i < resumePoints.length; i++) {
      expect(nth(resumePoints, i, "resumePoints")).toBeGreaterThan(nth(resumePoints, i - 1, "resumePoints"));
      expect(nth(resumePoints, i, "resumePoints") - nth(resumePoints, i - 1, "resumePoints")).toBe(2);
    }
    // The LAST page that carries the body has an EMPTY outbound for it: the body
    // finishes (no entry's outbound continues past the final inbound). Concretely,
    // the final page rendering fnBig has no further footnoteContinuation page after
    // it referencing fnBig.
    const lastResume = nth(resumePoints, resumePoints.length - 1, "resumePoints");
    expect(lastResume).toBeLessThan(12); // last inbound resumes before the end
    // 12 lines, 2 per page starting at page 0 ⇒ inbound resumes at 2,4,6,8,10 ⇒
    // the body finishes on the page whose inbound is 10 (renders lines 10,11).
    expect(resumePoints).toEqual([2, 4, 6, 8, 10]);
  });

  it("a VERY tall footnote (40 lines → 20+ continuation pages) resolves WITHOUT throwing; lines partition across all pages with no loss (Fix 1: line/height-based tail bound, not render-node count)", () => {
    // Regression for the UNSOUND render-node-based `maxPages` bound. A splitBody
    // is only ~3 render nodes (root + para + text), so the OLD bound
    // `metas.length*2 + totalFootnoteNodeCount + 2` = 1*2 + 3 + 2 = 7 pages —
    // FAR below the real chain length. This body is 40 lines (640px); at 2
    // lines/page it drains across 20+ pages, so the old bound would FALSELY throw
    // "page count exceeded" on a VALID document. The line/height-based bound
    // (`metas.length*2 + ⌈totalFootnoteContentHeight⌉ + 2` = 2 + 640 + 2 = 644) is
    // sound: each tail page drains ≥1 line ≥1px, so #tail-pages ≤ ⌈heightPx⌉.
    const BODY_LINES = 40;
    const render = fnDoc([fnPara("b0")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupSplit(render, new Map([["fnTall", BODY_LINES]]));

    const anchors = [fnAnchor("b0", "fnTall")];
    // The headline assertion: this MUST NOT throw (the old render-node bound did).
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // maxSlot per page = 64 − 16 − 13 = 35 ⇒ 2 lines (32px) per page ⇒ 40 lines
    // span 20 pages. The body STARTS on page 0 and carries forward each page.
    expect(out.entries.length).toBeGreaterThanOrEqual(20);
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fnTall"]);

    // No-loss partition: page 0 places lines [0,2); each later page that carries
    // fnTall inbound resumes exactly where the prior page stopped — the inbound
    // resume points are 2,4,6,…,38 (strictly increasing, step 2, covering all 40
    // lines). The TOTAL lines placed across every page == 40, with no overlap.
    const resumePoints: number[] = [0]; // page 0 starts at line 0 (no inbound)
    for (let i = 1; i < out.entries.length; i++) {
      const cont = nth(out.entries, i, "entries").footnoteContinuation;
      expect(cont).toHaveLength(1);
      expect(nth(cont, 0, "cont").contentBlockId).toBe("fnTall");
      const r = resumeAtLineOf(nth(cont, 0, "cont").resumeToken);
      expect(r).not.toBeNull();
      if (r !== null) resumePoints.push(r);
    }
    // Step-2 strictly-increasing inbound resume sequence: 0,2,4,…,38.
    for (let i = 1; i < resumePoints.length; i++) {
      expect(nth(resumePoints, i, "resumePoints") - nth(resumePoints, i - 1, "resumePoints")).toBe(2);
    }
    expect(nth(resumePoints, 0, "resumePoints")).toBe(0);
    expect(nth(resumePoints, resumePoints.length - 1, "resumePoints")).toBe(BODY_LINES - 2); // 38

    // Total lines placed = (last resume start + lines on the last page) = the body
    // line count, with no overlap. Each page placed exactly 2 lines; #carry-pages =
    // resumePoints.length, so 2 * resumePoints.length == 40.
    expect(2 * resumePoints.length).toBe(BODY_LINES);

    // The last page's OUTBOUND is empty: no page after the final fnTall page carries
    // it ⇒ the chain drained fully (the body finished, nothing lost).
    const lastFnPageIdx = out.entries.length - 1;
    expect(nth(out.entries, lastFnPageIdx, "entries").footnoteContinuation).toHaveLength(1);
    // The final inbound resumes at 38 (renders lines 38,39 = the last 2). There is
    // no entry beyond it referencing fnTall ⇒ outbound empty.
    expect(resumeAtLineOf(nth(nth(out.entries, lastFnPageIdx, "entries").footnoteContinuation, 0, "footnoteContinuation").resumeToken)).toBe(
      BODY_LINES - 2,
    );
  });

  it("Blocker-1 carry: a page with anchors A,B,C where the slot fits A + partial B → the NEXT page inbound = [{B,token},{C,null}], C not lost and NOT in page 0's footnoteContentBlockIds", () => {
    // ONE host block b0 anchors all three footnotes (A,B,C). A single host keeps
    // the body content small (16px) so a BOUNDED footnote slot can split B without
    // evicting the anchor block (a multi-block host would be evicted by the slot —
    // the bounded-slot ⇄ body-content tension). The slot is bounded by
    // maxSlot = pageContentBlockSize − 16 − 13:
    //   page content = 89 ⇒ maxSlot = 60 ⇒ A(16) + 2 lines of B(32) = 48 placed,
    //   B's 3rd line + C(16) would push past 60, so B splits (1 line carries) and
    //   C fully defers. Body beneath = 89 − 61 = 28 ≥ 16 ⇒ b0 still fits page 0.
    const TALL: PageConfig = { ...FN_PAGE, pageBlockSize: 89 };
    const render = fnDoc([fnPara("b0")]);
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupSplit(render, new Map([["A", 1], ["B", 3], ["C", 1]]), TALL);

    const anchors = [fnAnchor("b0", "A"), fnAnchor("b0", "B"), fnAnchor("b0", "C")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Page 0: inbound empty; A and B STARTED here (C did NOT) ⇒ only A,B in
    // footnoteContentBlockIds. Slot = sep + A(16) + B-partial(32) = 61.
    expect(nth(out.entries, 0, "entries").footnoteContinuation).toEqual([]);
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["A", "B"]);
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).not.toContain("C"); // C not started here
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBe(FOOTNOTE_SEPARATOR_HEIGHT + 16 + 2 * 16); // 61

    // Page 1 inbound = [{B, token@line2}, {C, null}] — B's remainder carried AND C
    // carried (Blocker-1: C is NOT lost even though its anchor was on page 0).
    expect(out.entries.length).toBeGreaterThanOrEqual(2);
    const p1 = nth(out.entries, 1, "entries");
    expect(p1.footnoteContinuation).toHaveLength(2);
    expect(nth(p1.footnoteContinuation, 0, "footnoteContinuation").contentBlockId).toBe("B");
    expect(resumeAtLineOf(nth(p1.footnoteContinuation, 0, "footnoteContinuation").resumeToken)).toBe(2);
    expect(nth(p1.footnoteContinuation, 1, "footnoteContinuation").contentBlockId).toBe("C");
    expect(nth(p1.footnoteContinuation, 1, "footnoteContinuation").resumeToken).toBeNull(); // C never started
  });

  it("E6(a): a change to the PRIOR page's split point (body grows) invalidates the next page's reuse — the next page re-resolves (body-layout probe climbs)", () => {
    // Page 0 STARTS a footnote whose remainder carries to page 1. Editing the
    // body (1 extra line) moves where the body splits ⇒ page 1's INBOUND
    // continuation changes. The reuse gate (E6(a)) must refuse to reuse page 1's
    // prior resolution: the body is re-laid-out on page 1 (probe climbs).
    //
    // Doc: b0 anchors a body big enough to split across pages 0→1, plus filler
    // paras so there IS a page 1 to reuse-or-not. Body fnBig spans pages.
    const render0 = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"),
    ]);
    const cascaded0 = fnCascade(render0);
    const metas0 = buildBlockFitMetas(cascaded0, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const sectionPlan0 = buildSectionPlan(cascaded0, FN_PAGE);
    const rootChildren0 = flattenContents(cascaded0.children) as ElementBox[];
    const rawPlan0 = measurePass(metas0, FN_PAGE, sectionPlan0, rootChildren0);
    const fnCtxLocal = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);

    // 6-line body (96px). maxSlot per page = 64 − 16 − 13 = 35 ⇒ 2 lines/page ⇒
    // body spans pages 0,1,2 — page 1 carries an INBOUND continuation.
    const bodyA = splitBody("fnBig", 6);
    const embedA = new Map<BlockId, ElementBox>([["fnBig" as BlockId, bodyA]]);
    const anchors = [fnAnchor("b0", "fnBig")];

    const resolved0 = resolveFootnotes(
      rawPlan0, metas0, sectionPlan0, rootChildren0,
      embedA, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    // Page 1 carries fnBig's remainder inbound at resumeAtLine 2.
    expect(nth(resolved0.entries, 1, "entries").footnoteContinuation).toHaveLength(1);
    expect(resolveAtLineHelper(nth(resolved0.entries, 1, "entries"))).toBe(2);

    // Cycle 2: grow the body to 8 lines (a NEW ElementBox ref). The page-0 split
    // point is UNCHANGED (still 2 lines on page 0 ⇒ inbound still resumeAtLine 2),
    // but the body REF changed, so the gate's body-ref check ALONE already forces
    // a miss. To isolate the E6(a) inbound-LIST check we instead change the page-0
    // split WITHOUT changing the body ref: shrink page 0's available slot by
    // adding a SECOND footnote on b0 that consumes a line, pushing fnBig's split
    // earlier. Simpler + sufficient for E6(a): assert the gate refuses reuse when
    // the inbound continuation list differs. We do that by re-resolving with a
    // DIFFERENT prior plan whose page-1 inbound differs.
    //
    // Construct a prior plan whose page-1 inbound resumeAtLine is DIFFERENT (3,
    // not 2) by reusing resolved0 but as if the split were elsewhere: the cleanest
    // probe is to feed the SAME doc but a body that splits at a different point.
    const bodyB = splitBody("fnBig", 8); // longer body, still 2 lines/page on p0
    const embedB = new Map<BlockId, ElementBox>([["fnBig" as BlockId, bodyB]]);
    expect(bodyB).not.toBe(bodyA);

    __resetBodyLayoutCallCountForTest();
    const resolvedIncremental = resolveFootnotes(
      rawPlan0, metas0, sectionPlan0, rootChildren0,
      embedB, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
      resolved0, embedA,
    );
    // The body changed ⇒ page 0 misses (cond 5). Page 1's inbound continuation
    // also differs because the carried body ref changed ⇒ page 1 misses too. The
    // body-layout probe climbs above 0 (the footnote pages re-resolved).
    expect(__getBodyLayoutCallCountForTest()).toBeGreaterThan(0);
    // The re-resolved plan equals a fresh full build (no stale inbound).
    const resolvedFresh = resolveFootnotes(
      rawPlan0, metas0, sectionPlan0, rootChildren0,
      embedB, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(resolvedIncremental.entries.map((e) => e.footnoteSlotHeight)).toEqual(
      resolvedFresh.entries.map((e) => e.footnoteSlotHeight),
    );
    for (let i = 0; i < resolvedFresh.entries.length; i++) {
      const inc = nth(resolvedIncremental.entries, i, "entries").footnoteContinuation;
      const fresh = nth(resolvedFresh.entries, i, "entries").footnoteContinuation;
      expect(inc.map((c) => c.contentBlockId)).toEqual(fresh.map((c) => c.contentBlockId));
      expect(inc.map((c) => resumeAtLineOf(c.resumeToken))).toEqual(
        fresh.map((c) => resumeAtLineOf(c.resumeToken)),
      );
    }
  });

  it("E6(a) gate refuses reuse when the inbound continuation LIST differs even though geometry + child refs match (cap-style isolation)", () => {
    // Direct unit-level proof that `canReuseFootnotePage`'s inbound check fires:
    // build two resolves of the SAME doc whose ONLY difference is the prior page's
    // split point, and assert the downstream page re-resolves. We probe this
    // through the full pass: cycle 1 a 6-line body; cycle 2 a 4-line body (NEW
    // ref). The body-ref already forces a miss, but the inbound continuation list
    // for page 1 ALSO differs — the assertion checks the resolved continuation is
    // the FRESH one (not the stale prior), proving no spurious reuse leaked the old
    // split.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const sectionPlan = buildSectionPlan(cascaded, FN_PAGE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const rawPlan = measurePass(metas, FN_PAGE, sectionPlan, rootChildren);
    const fnCtxLocal = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
    const anchors = [fnAnchor("b0", "fnBig")];

    const bodyA = splitBody("fnBig", 6);
    const embedA = new Map<BlockId, ElementBox>([["fnBig" as BlockId, bodyA]]);
    const resolvedA = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embedA, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
    );

    const bodyB = splitBody("fnBig", 3); // shorter ⇒ finishes on page 1 (no page 2)
    const embedB = new Map<BlockId, ElementBox>([["fnBig" as BlockId, bodyB]]);
    const resolvedIncremental = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embedB, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
      resolvedA, embedA,
    );
    const resolvedFresh = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embedB, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
    );

    // The incremental result's continuation lists match the FRESH build (no stale
    // 6-line split leaked through a spurious reuse).
    for (let i = 0; i < resolvedFresh.entries.length; i++) {
      const inc = nth(resolvedIncremental.entries, i, "entries").footnoteContinuation;
      const fresh = nth(resolvedFresh.entries, i, "entries").footnoteContinuation;
      expect(inc.map((c) => c.contentBlockId)).toEqual(fresh.map((c) => c.contentBlockId));
      expect(inc.map((c) => resumeAtLineOf(c.resumeToken))).toEqual(
        fresh.map((c) => resumeAtLineOf(c.resumeToken)),
      );
      expect(nth(resolvedIncremental.entries, i, "entries").footnoteContentBlockIds).toEqual(
        nth(resolvedFresh.entries, i, "entries").footnoteContentBlockIds,
      );
    }
  });

  it("Fix 2 — condition-6 ISOLATION: with the body REF held STABLE (cond 5 passes), a DIFFERENT prior-page split point (page-1 inbound token differs) ALONE refuses page-1 reuse via cond 6", () => {
    // The two E6(a) tests above change the body REF, so cond 5 (assigned-body-ref)
    // trips BEFORE cond 6 (inbound-list) is reached — neither proves cond 6 fires.
    // This test isolates cond 6: the SAME body ElementBox is fed as both the
    // current AND the prior cascaded body (so cond 5 passes), and the ONLY thing
    // that differs is the prior page-1 entry's inbound `footnoteContinuation` token.
    //
    // Differential design: page 0 is forced to RE-RESOLVE in both runs (so it
    // threads the REAL outbound into page 1, not the prior plan's stored one) by
    // giving the prior plan's page-0 entry a non-null `resumeInto` (cond 2 miss).
    //   - CONTROL run: prior page-1 inbound token = the REAL one ⇒ cond 6 PASSES ⇒
    //     page 1 REUSES ⇒ its body is NOT re-laid-out.
    //   - TEST run:    prior page-1 inbound token = a DIFFERENT (line-3) token ⇒
    //     cond 6 FAILS ⇒ page 1 RE-RESOLVES ⇒ its body IS re-laid-out.
    // The body-layout call counter therefore climbs MORE in the test run, isolating
    // cond 6 as the sole cause of the page-1 re-resolution.
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const sectionPlan = buildSectionPlan(cascaded, FN_PAGE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const rawPlan = measurePass(metas, FN_PAGE, sectionPlan, rootChildren);
    const fnCtxLocal = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
    const anchors = [fnAnchor("b0", "fnBig")];

    // A 6-line body. maxSlot per page = 64 − 16 − 13 = 35 ⇒ 2 lines/page ⇒ the
    // body spans pages 0,1,2; page 1's REAL inbound resumes at line 2.
    const body = splitBody("fnBig", 6);
    const embed = new Map<BlockId, ElementBox>([["fnBig" as BlockId, body]]);

    // The REAL resolved plan (no prior). Page 1's inbound = [{fnBig, token@line2}].
    const real = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embed, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
    );
    expect(resolveAtLineHelper(nth(real.entries, 1, "entries"))).toBe(2); // sanity: real split @ line 2

    // A DIFFERENT but valid inbound token: fnBig resuming at line 3 (the same body,
    // a different prior-page split point). Built by laying the body bounded to 3
    // lines, which yields a token resuming after line 3.
    const tokenLine3 = partialToken(body, 3 * SLOT_LINE);
    expect(resumeAtLineOf(tokenLine3)).toBe(3);

    // Clone a plan, overriding specific entries. `buildPagePlan` only needs the
    // entries for `resolveFootnotes`'s reuse path (it indexes entries by
    // `startIndex`); empty block maps suffice since the reuse path never calls the
    // index methods.
    const buildPriorPlan = (
      overrides: ReadonlyMap<number, Partial<PagePlanEntry>>,
    ): PagePlan => {
      const entries = real.entries.map((e, i) => {
        const o = overrides.get(i);
        return o === undefined ? e : { ...e, ...o };
      });
      return buildPagePlan(
        entries, real.sectionPlan, real.pageInlineSize, real.pageContentBlockSize,
        new Map(), new Map(),
      );
    };

    // Page-0 override (BOTH runs): a non-null `resumeInto` so cond 2 forces page 0
    // to re-resolve (it threads the REAL outbound into page 1, defeating the
    // tamper-propagation that a page-0 REUSE would cause).
    const fakeResumeInto: BreakToken = {
      type: "block", resumeChildIndex: 99, resumeChildToken: null,
    };
    const page0Override: Partial<PagePlanEntry> = { resumeInto: fakeResumeInto };

    // CONTROL: page-1 inbound LEFT real ⇒ cond 6 passes ⇒ page 1 reuses.
    const prevControl = buildPriorPlan(new Map([[0, page0Override]]));
    __resetBodyLayoutCallCountForTest();
    resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embed, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
      prevControl, embed, // prior cascaded = SAME body ref ⇒ cond 5 passes
    );
    const controlBodyLayouts = __getBodyLayoutCallCountForTest();

    // TEST: page-1 inbound token swapped to @line3 ⇒ cond 6 fails ⇒ page 1
    // re-resolves. Everything else (body ref, geometry, children, cond 5) matches.
    const page1Real = nth(real.entries, 1, "entries");
    const tamperedPage1: Partial<PagePlanEntry> = {
      footnoteContinuation: [
        { contentBlockId: nth(page1Real.footnoteContinuation, 0, "footnoteContinuation").contentBlockId, resumeToken: tokenLine3 },
      ],
    };
    const prevTest = buildPriorPlan(new Map([
      [0, page0Override],
      [1, tamperedPage1],
    ]));
    __resetBodyLayoutCallCountForTest();
    resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embed, anchors, fnCtxLocal, FN_SHAPER, undefined, undefined, FN_PAGE,
      prevTest, embed,
    );
    const testBodyLayouts = __getBodyLayoutCallCountForTest();

    // The inbound-list difference ALONE (cond 6) forced page 1 to re-resolve: the
    // test run lays out MORE footnote bodies than the control (which reused page 1).
    expect(testBodyLayouts).toBeGreaterThan(controlBodyLayouts);
  });
});

/** Convenience: the inbound continuation's resumeAtLine for a 1-element list. */
function resolveAtLineHelper(entry: PagePlanEntry): number | null {
  if (entry.footnoteContinuation.length !== 1) return null;
  return resumeAtLineOf(nth(entry.footnoteContinuation, 0, "footnoteContinuation").resumeToken);
}

// ===========================================================================
// FN-6.4 slice 1 — VirtualLayoutTree.footnoteAnchorPages exposed via the REAL
// producer (buildVirtualPaginatedTree). Each footnote body → the RESOLVED page
// index its ANCHOR REFERENCE marker renders on (resolved-plan source of truth —
// audit F2: footnote-slot eviction can move an anchor past its raw-plan page).
// Consumed by FN-6.4 slices 2-6 (restart-per-page numbering).
// ===========================================================================

describe("VirtualLayoutTree.footnoteAnchorPages (FN-6.4 slice 1, producer path)", () => {
  const fnCtx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);

  it("a footnote-free doc → empty map (no crash)", () => {
    const cascaded = fnCascade(fnDoc([fnPara("b0"), fnPara("b1")]));
    const tree = buildVirtualPaginatedTree(cascaded, fnCtx, FN_SHAPER, FN_PAGE);
    expect(tree.footnoteAnchorPages.size).toBe(0);
  });

  it("two footnotes whose anchors land on DIFFERENT pages → each maps to its anchor's RESOLVED page", () => {
    // 8 paras ⇒ raw plan is 2 pages (4 each: b0..b3 page 0, b4..b7 page 1).
    // Footnote on b0 and on b4. footnoteAnchorPages keys on the RESOLVED page each
    // anchor renders on: fn0 stays on page 0, but the footnote slots shrink the
    // early pages enough that b4 spills past raw page 1 to resolved page 2 (audit
    // F2). The map mirrors the resolved plan's `pageSpanOfBlock(...).first`.
    const render = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"), fnPara("b6"), fnPara("b7"),
    ]);
    const cascaded = fnCascade(render);
    // Sanity: the RAW measure plan splits b0/b4 across pages 0/1 (pre-slot).
    const rawInputs = inputsFrom(cascaded);
    expect(rawInputs.rawPlan.pageIndexOfBlock("b0")).toBe(0);
    expect(rawInputs.rawPlan.pageIndexOfBlock("b4")).toBe(1);

    const embed = new Map<BlockId, ElementBox>([
      ["fn0" as BlockId, fnCascade(fnBody("fn0", 1))],
      ["fn4" as BlockId, fnCascade(fnBody("fn4", 1))],
    ]);
    const anchors = [fnAnchor("b0", "fn0"), fnAnchor("b4", "fn4")];

    const tree = buildVirtualPaginatedTree(
      cascaded, fnCtx, FN_SHAPER, FN_PAGE, undefined, new Map(), embed, anchors,
    );

    // Each maps to its host block's RESOLVED page (the plan is the source of truth).
    expect(tree.footnoteAnchorPages.get("fn0" as BlockId)).toBe(tree.plan.pageSpanOfBlock("b0")?.first);
    expect(tree.footnoteAnchorPages.get("fn4" as BlockId)).toBe(tree.plan.pageSpanOfBlock("b4")?.first);
    // Resolved: fn0 on page 0, fn4 evicted to page 2 (still distinct pages).
    expect(tree.footnoteAnchorPages.get("fn0" as BlockId)).toBe(0);
    expect(tree.footnoteAnchorPages.get("fn4" as BlockId)).toBe(2);
    expect(tree.footnoteAnchorPages.size).toBe(2);
  });

  it("two footnotes whose anchors are on the SAME page → both map to that page", () => {
    // b0 and b1 both on raw page 0 (a TALL page so the slot doesn't matter for
    // the raw assignment). Both anchors → page 0.
    const TALL: PageConfig = { ...FN_PAGE, pageBlockSize: 128 };
    const render = fnDoc([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const cascaded = fnCascade(render);
    const embed = new Map<BlockId, ElementBox>([
      ["fnA" as BlockId, fnCascade(fnBody("fnA", 1))],
      ["fnB" as BlockId, fnCascade(fnBody("fnB", 1))],
    ]);
    const anchors = [fnAnchor("b0", "fnA"), fnAnchor("b1", "fnB")];

    const tree = buildVirtualPaginatedTree(
      cascaded, fnCtx, FN_SHAPER, TALL, undefined, new Map(), embed, anchors,
    );

    expect(tree.footnoteAnchorPages.get("fnA" as BlockId)).toBe(0);
    expect(tree.footnoteAnchorPages.get("fnB" as BlockId)).toBe(0);
    expect(tree.footnoteAnchorPages.size).toBe(2);
  });

  it("matches footnoteAnchorPageAssignment over the RESOLVED plan (same source of truth)", () => {
    // The exposed map must equal `footnoteAnchorPageAssignment` over the tree's
    // RESOLVED plan (NOT the raw plan): the marker renders on the resolved page, so
    // the resolved plan is the numbering source of truth (audit F2). Over the raw
    // plan the two would DIVERGE whenever a footnote slot evicts an anchor.
    const render = fnDoc([
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"), fnPara("b6"), fnPara("b7"),
    ]);
    const cascaded = fnCascade(render);
    const rawInputs = inputsFrom(cascaded);
    const embed = new Map<BlockId, ElementBox>([
      ["fn0" as BlockId, fnCascade(fnBody("fn0", 1))],
      ["fn4" as BlockId, fnCascade(fnBody("fn4", 1))],
    ]);
    const anchors = [fnAnchor("b0", "fn0"), fnAnchor("b4", "fn4")];

    const tree = buildVirtualPaginatedTree(
      cascaded, fnCtx, FN_SHAPER, FN_PAGE, undefined, new Map(), embed, anchors,
    );

    const expected = footnoteAnchorPageAssignment(
      anchors,
      tree.plan, // RESOLVED plan
      buildBlockToTopLevelIndex(rawInputs.rootChildren),
    );
    expect(tree.footnoteAnchorPages.get("fn0" as BlockId)).toBe(expected.get("fn0" as BlockId));
    expect(tree.footnoteAnchorPages.get("fn4" as BlockId)).toBe(expected.get("fn4" as BlockId));
    expect(tree.footnoteAnchorPages.size).toBe(expected.size);
    // And it genuinely DIFFERS from the raw-plan assignment (regression guard): the
    // raw plan groups fn4 on page 1, the resolved plan on page 2.
    const rawAssignment = footnoteAnchorPageAssignment(
      anchors, rawInputs.rawPlan, buildBlockToTopLevelIndex(rawInputs.rootChildren),
    );
    expect(rawAssignment.get("fn4" as BlockId)).toBe(1);
    expect(tree.footnoteAnchorPages.get("fn4" as BlockId)).toBe(2);
  });
});

// ===========================================================================
// 3.5a — resolveFootnotes threads/unwraps a multicol page's `ColumnBreakToken`.
// `resolveFootnotes` runs after `measurePass` and REWRITES the PagePlanEntry[],
// threading resumeOut → next page's resumeInto exactly like the measure loop.
// A multicol page's `resumeOut` is a `ColumnBreakToken`; without unwrapping it
// via `innerBfcToken`, the page-level block-axis reads (`nextStartIndex`,
// `recordBlockMaps`) fall to the wrong branch and CORRUPT the boundaries — even
// for a footnote-FREE multicol page swept over because a LATER page carries a
// footnote. (Full multicol+footnote re-distribution is deferred to 3.5b.)
// ===========================================================================
describe("resolveFootnotes — multicol ColumnBreakToken threading (3.5a)", () => {
  /** Build resolveFootnotes inputs with an explicit multicol SectionPlan. */
  function setupCols(
    renderRoot: ElementBox,
    bodies: ReadonlyMap<string, ElementBox>,
    sectionPlan: SectionPlan,
    pageConfig: PageConfig = FN_PAGE,
  ) {
    const cascaded = fnCascade(renderRoot);
    const metas = buildBlockFitMetas(cascaded, FN_SHAPER, undefined, FN_CONTENT_INLINE);
    const rootChildren = flattenContents(cascaded.children) as ElementBox[];
    const rawPlan = measurePass(metas, pageConfig, sectionPlan, rootChildren);
    const cascadedEmbedContents = new Map<BlockId, ElementBox>();
    for (const [id, body] of bodies) {
      cascadedEmbedContents.set(id as BlockId, fnCascade(body));
    }
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, FN_CONTENT_INLINE);
    return { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig };
  }

  const TWO_COL: SectionPlan = {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
  };

  it("footnote-FREE 2-column pages carry forward UNCORRUPTED (column token threading)", () => {
    // 12 single-line paras, 2 columns, 64px page (4 lines ⇒ 8 blocks/page).
    // RAW measure plan: page 0 = column token at index 8 (b0..b7), page 1 = b8..b11.
    // A footnote on b8 (page 1's first block) makes `resolveFootnotes` SWEEP from
    // page 1 — but it carries page 0 (a footnote-FREE multicol page whose
    // `resumeOut` is a `ColumnBreakToken`) through unchanged. WITHOUT the unwrap
    // fix, page 0's `recordBlockMaps`/`nextStartIndex` reads of the column token
    // mis-map ALL remaining blocks onto page 0 — `pageSpanOfBlock` for the page-1
    // blocks then wrongly reports page 0. With the fix the boundaries match raw.
    const render = fnDoc(Array.from({ length: 12 }, (_, i) => fnPara(`b${i}`)));
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupCols(render, new Map([["fn8", fnBody("fn8", 1)]]), TWO_COL);

    // Sanity: the raw multicol plan is 2 pages with a column token on page 0.
    expect(rawPlan.entries.length).toBe(2);
    expect(nth(rawPlan.entries, 0, "entries").resumeOut?.type).toBe("column");
    expect(nth(rawPlan.entries, 0, "entries").startIndex).toBe(0);
    expect(nth(rawPlan.entries, 1, "entries").startIndex).toBe(8);
    expect(nth(rawPlan.entries, 1, "entries").resumeOut).toBeNull();

    const anchors = [fnAnchor("b8", "fn8")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Page 0 (footnote-free multicol) is carried through with its boundaries +
    // column token byte-identical to the raw plan — never corrupted.
    expect(nth(out.entries, 0, "entries").startIndex).toBe(0);
    expect(nth(out.entries, 0, "entries").resumeOut).toBe(nth(rawPlan.entries, 0, "entries").resumeOut);
    expect(nth(out.entries, 0, "entries").resumeOut?.type).toBe("column");
    expect(nth(out.entries, 0, "entries").columnConfig.columnCount).toBe(2);

    // Page 0's own blocks (b0..b7) stay on page 0 — NOT spread across later pages.
    // This is the load-bearing guard: a mis-threaded column token makes page 0's
    // `recordBlockMaps` set `lastOccupied = metas.length - 1`, claiming ALL blocks
    // (b8..b11 included) on page 0 (`pageSpanOfBlock(...).first === 0`).
    for (let i = 0; i < 8; i++) {
      expect(out.pageSpanOfBlock(`b${i}`), `b${i} span`).toEqual({ first: 0, last: 0 });
    }
    // Page 1+ blocks (b8..b11) are NOT mis-claimed by page 0 — their span starts
    // strictly AFTER page 0. (Their exact page can shift past page 1 because the
    // footnote on b8 reserves a slot that evicts later blocks — correct behavior,
    // distinct from the column-token corruption this test guards against.)
    for (let i = 8; i < 12; i++) {
      const span = out.pageSpanOfBlock(`b${i}`);
      expect(span, `b${i} span present`).not.toBeNull();
      expect(span?.first, `b${i} not on page 0`).toBeGreaterThan(0);
    }
  });

  it("footnote-BEARING 2-column page re-fits via fitColumnsOnPage at the slot-reduced height (3.5b convergence)", () => {
    // A 2-column page that carries a footnote anchor must re-distribute its body
    // across 2 columns at the SLOT-REDUCED height (Google Docs: footnotes span the
    // full page width below the body; the body columns shrink uniformly into
    // `pageContentBlockSize - footnoteSlotHeight`). Before 3.5b the miss-path re-fit
    // ran a single-column `fitOnePage`, COLLAPSING the page to one column
    // (`columnFit === undefined`); after 3.5b it runs `fitColumnsOnPage` and stamps
    // a real `ColumnsFitResult`.
    const render = fnDoc(Array.from({ length: 12 }, (_, i) => fnPara(`b${i}`)));
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupCols(render, new Map([["fn0", fnBody("fn0", 1)]]), TWO_COL);

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // The footnote slot for fn0 is reserved page-wide on the page carrying b0 (page 0).
    expect(nth(out.entries, 0, "entries").footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(nth(out.entries, 0, "entries").footnoteSlotHeight).toBeGreaterThan(0);

    // 3.5b: the footnote-bearing page's body is re-fit as 2 columns (NOT collapsed
    // to single-column). `columnFit` is DEFINED with 2 columns.
    const cf = nth(out.entries, 0, "entries").columnFit;
    expect(cf, "footnote-bearing multicol page keeps its columnFit").toBeDefined();
    expect(cf?.columns.length).toBe(2);
    expect(nth(out.entries, 0, "entries").columnConfig.columnCount).toBe(2);

    // Each non-empty column shrinks into the slot-reduced height: its consumed
    // block-size leaves room for the page-wide footnote slot.
    const effTopInset = pageConfig.pageMargins.blockStart;
    const effBottomInset = pageConfig.pageMargins.blockEnd;
    const pageContentBlockSize = pageConfig.pageBlockSize - effTopInset - effBottomInset;
    const reducedHeight = pageContentBlockSize - nth(out.entries, 0, "entries").footnoteSlotHeight;
    for (const col of cf?.columns ?? []) {
      if (col.childrenCount === 0) continue;
      expect(
        col.consumedBlockSize,
        "column shrinks into the slot-reduced height",
      ).toBeLessThanOrEqual(reducedHeight);
    }
  });

  it("F-1: a capped multicol footnote page synthesizes a forced-break so the next section is NOT dropped (3.5b fitBody synth)", () => {
    // Two sections, both 2-column: section 1 = b0..b3 (capped before index 4),
    // section 2 = b4..b7. A footnote on b0 puts section 1's page in the footnote
    // sweep, so its body is re-fit by `fitBody` → `fitColumnsOnPage`. Section 1's
    // 4 blocks FIT within its 2 columns at the slot-reduced height, so
    // `fitColumnsOnPage` exhausts AT the section cap (index 4) and returns
    // `pageResumeOut === null` — even though section 2 still follows. Without the
    // F-1 forced-break synthesis in `fitBody`, `resolvedResumeOut` would be null,
    // the sweep would treat page 0 as the document end, and section 2's blocks
    // (b4..b7) would be SILENTLY DROPPED. The synth makes `resumeOut` a block token
    // at index 4 so the sweep continues and section 2 paginates.
    const sectioned: SectionPlan = {
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "s1" as BlockId },
        { startFlattenedIndex: 4, sectionId: "s2" as BlockId },
      ],
      effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
    };
    const render = fnDoc(Array.from({ length: 8 }, (_, i) => fnPara(`b${i}`)));
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupCols(render, new Map([["fn0", fnBody("fn0", 1)]]), sectioned);

    // Sanity: the raw plan caps section 1 on page 0 (b0..b3) and starts section 2
    // on page 1 — measurePass's own T3 F-1 synth produced the page-0 forced-break.
    expect(rawPlan.entries.length).toBeGreaterThanOrEqual(2);
    expect(nth(rawPlan.entries, 0, "entries").activeSectionId).toBe("s1");
    expect(nth(rawPlan.entries, 0, "entries").resumeOut?.type).toBe("block");

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // Page 0 (section 1, re-fit by the footnote sweep) carries the synthesized
    // forced-break at the section boundary — NOT a stale null that would end the doc.
    expect(nth(out.entries, 0, "entries").activeSectionId).toBe("s1");
    expect(nth(out.entries, 0, "entries").resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 4,
      resumeChildToken: null,
    });
    // And it kept its 2-column distribution (3.5b body re-fit).
    expect(nth(out.entries, 0, "entries").columnFit?.columns.length).toBe(2);

    // Section 2's blocks are NOT dropped — every one appears on some page > 0.
    for (let i = 4; i < 8; i++) {
      const span = out.pageSpanOfBlock(`b${i}`);
      expect(span, `b${i} (section 2) present`).not.toBeNull();
      expect(span?.first, `b${i} on a page after section 1`).toBeGreaterThan(0);
    }
  });

  it("T4b: a footnote-bearing FINAL multicol page BALANCES its columns at the slot-reduced height", () => {
    // A short 2-column section whose ONLY page carries a footnote. FILL alone dumps
    // all of the page's body into column 0 (the slot-reduced height still holds it
    // all) and leaves column 1 empty — the ugly `column-fill: auto` look. Google
    // Docs / Word balance the FINAL page (`column-fill: balance`): the body is
    // re-fit at the minimal even per-column height so BOTH columns carry content,
    // BELOW the page (where the footnote slot spans the full width). T4b applies
    // that balance on the footnote sweep's final multicol page too — measurePass
    // already balances footnote-free final pages, so without T4b a page would lose
    // its balance the moment a footnote landed on it.
    const TALL: PageConfig = { ...FN_PAGE, pageBlockSize: 128 };
    // 4 single-line paras (16px each). availBody = 128 − slotHeight (~29 for a
    // 1-line footnote) ≈ 99 ⇒ all 4 (64px) FILL into column 0; column 1 empty.
    const render = fnDoc(Array.from({ length: 4 }, (_, i) => fnPara(`b${i}`)));
    const { rawPlan, metas, sectionPlan, rootChildren, cascadedEmbedContents, ctx, pageConfig } =
      setupCols(render, new Map([["fn0", fnBody("fn0", 1)]]), TWO_COL, TALL);

    const anchors = [fnAnchor("b0", "fn0")];
    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      cascadedEmbedContents, anchors, ctx, FN_SHAPER, undefined, undefined, pageConfig,
    );

    // The section fits on ONE page (its final page), and it carries fn0's slot.
    expect(out.entries.length).toBe(1);
    const entry = nth(out.entries, 0, "entries");
    expect(entry.footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(entry.footnoteSlotHeight).toBeGreaterThan(0);

    const effTopInset = pageConfig.pageMargins.blockStart;
    const effBottomInset = pageConfig.pageMargins.blockEnd;
    const pageContentBlockSize = pageConfig.pageBlockSize - effTopInset - effBottomInset;
    const reducedHeight = pageContentBlockSize - entry.footnoteSlotHeight;

    // BALANCE (T4b): the per-column rendered height is the MINIMAL even height
    // (≈ 2 paras = 32px), strictly below the slot-reduced FILL height. Without T4b
    // this equals `reducedHeight` (the page just FILLs into the reduced body).
    expect(entry.balancedColumnHeight).toBeLessThan(reducedHeight);

    // And the balance spreads the body across BOTH columns (FILL left col 1 empty).
    const cf = entry.columnFit;
    expect(cf, "final multicol footnote page keeps its columnFit").toBeDefined();
    if (cf === undefined) throw new Error("expected columnFit on final multicol footnote page");
    expect(cf.columns.length).toBe(2);
    expect(nth(cf.columns, 0, "columns").childrenCount, "col 0 non-empty").toBeGreaterThan(0);
    expect(nth(cf.columns, 1, "columns").childrenCount, "col 1 non-empty (balanced, not FILL)").toBeGreaterThan(0);
    // Balance only REDISTRIBUTES — all 4 paras stay placed (childrenCount invariant).
    expect(cf.totalChildrenCount).toBe(4);
  });
});
