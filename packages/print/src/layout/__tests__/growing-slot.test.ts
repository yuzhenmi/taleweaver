// packages/core/src/layout/__tests__/growing-slot.test.ts
//
// Task #328 — header/footer GROWING slot. A header taller than the page's top
// margin must GROW the top inset and PUSH the body content down (Google Docs
// behavior); the footer grows the bottom inset upward. Content is never
// clipped. The body content area shrinks accordingly, so a tall header reduces
// lines/page and can ADD pages.
//
// Model (per active section's page geometry):
//   headerHeight = cascaded header body's NATURAL laid-out blockSize (UNCAPPED).
//   effectiveTopInset    = max(pageMargins.blockStart, headerHeight)
//   effectiveBottomInset = max(pageMargins.blockEnd,  footerHeight)
//   body content area    = [effectiveTopInset, pageBlockSize − effectiveBottomInset]
//
// NO-REGRESSION: no slot → height 0 → max(margin, 0) = margin → byte-identical
// pagination. (Guarded by measure-pass-equivalence.test.ts + the existing
// virtual-layout-tree slot tests; here we add a direct equivalence pin.)

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { layoutTree } from "../dispatch";
import { layoutBlock } from "../bfc";
import type { LayoutContext } from "../layout-context";
import type { VirtualLayoutTree } from "../virtual-layout-tree";

// ---------------------------------------------------------------------------
// Fixture builders (mirror virtual-layout-tree.test.ts / measure-pass-equiv).
// ---------------------------------------------------------------------------

function cascadeRoot(
  rootStyle: Style,
  children: readonly ElementBox[],
  metadata?: Record<string, unknown>,
): ElementBox {
  const root = createElementBox("root", rootStyle, children, metadata);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function fixedBlock(key: string, blockSize: number, extra?: Partial<Style>): ElementBox {
  return createElementBox(key, { display: "block", blockSize, ...(extra ?? {}) } as Style, []);
}

/** A paragraph with `numLines` hard-wrapped lines (mock line-height 16). */
function paragraph(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "block", whiteSpace: "pre" } as Style, [textNode]);
}

/**
 * A paragraph whose text SOFT-wraps (space-separated one-char words). With the
 * mock shaper (charWidth 8, lineHeight 16) each one-char word costs 8px + an 8px
 * inter-word space, so a content inline-size W holds `floor((W + 8) / 16)` words
 * per line. The wrapped LINE COUNT (and thus the body's natural height) therefore
 * depends on the width it's laid out against — the lever for the landscape-width
 * M2 test.
 */
function softParagraph(key: string, wordCount: number): ElementBox {
  const text = Array.from({ length: wordCount }, () => "x").join(" ");
  const textNode = createTextBox(`${key}-t`, {}, text);
  return createElementBox(key, { display: "block" } as Style, [textNode]);
}

/** A page config with small top/bottom margins so a header overflows them. */
function pageConfig(
  pageBlockSize: number,
  marginBlock = 10,
  pageInlineSize = 600,
  pageGap = 20,
): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: marginBlock, blockEnd: marginBlock, inlineStart: 15, inlineEnd: 15 },
    pageGap,
  };
}

const shaper = () => createMockShaper(8, 16);

/** Build a VirtualLayoutTree via the real producer (exercises computeSlotInsets). */
function build(
  root: ElementBox,
  cfg: PageConfig,
  bodies: ReadonlyMap<BlockId, ElementBox> = new Map(),
  prev?: ReturnType<typeof buildVirtualPaginatedTree>,
) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  return buildVirtualPaginatedTree(root, ctx, shaper(), cfg, prev, bodies);
}

// ---------------------------------------------------------------------------
// (1) NO-REGRESSION: no slot ⇒ insets default to raw margins ⇒ unchanged plan.
// ---------------------------------------------------------------------------

describe("growing-slot — (1) NO-REGRESSION (no header/footer ⇒ raw margins)", () => {
  it("body origin = raw top margin and page count unchanged when there is no header", () => {
    // 6 blocks × 100 = 600; content area with 10/10 margins on a 300-tall page
    // is 280 ⇒ 2 blocks/page (200 ≤ 280, 300 > 280) ⇒ 3 pages.
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg);

    // No header ⇒ body's first block at the raw top margin (10), NOT pushed.
    const p0 = tree.getPage(0);
    const body0 = p0.children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(10);
    // 3 pages (2 blocks each).
    expect(tree.plan.entries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (2) Overflow PUSHES body down + ADDS pages.
// ---------------------------------------------------------------------------

describe("growing-slot — (2) tall header pushes body + adds pages", () => {
  it("effectiveTopInset = headerHeight (30) > margin (10): body origin pushed to 30", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });

    // Header body: a container whose natural laid-out height is 30 (a fixed block).
    const hdrBody = cascadeRoot({ display: "block" }, [fixedBlock("h0", 30)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);

    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    // Body origin pushed to effectiveTopInset = max(10, 30) = 30, and the
    // page-0 entry's stamped inset reflects it.
    expect(tree.plan.entries[0]?.effectiveTopInset).toBe(30);
    const body0 = tree.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(30);
    // (Content area now [30, 290] = 260 ⇒ still 2 blocks/page for these 100-tall
    // blocks; the page-COUNT increase is proven by the next test, which uses a
    // header tall enough to drop to 1 block/page.)
  });

  it("a header tall enough to drop lines/page strictly increases page count vs no-header", () => {
    // Page 300 tall, margins 10/10. No header: content 280 ⇒ 2 blocks of 100/page.
    // Header height 130 ⇒ effectiveTopInset 130 ⇒ content [130, 290] = 160 ⇒ 1
    // block/page. 4 blocks: no-header ⇒ 2 pages; with header ⇒ 4 pages.
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const cfg = pageConfig(300, 10);

    const baseline = build(cascadeRoot({ display: "block" }, children), cfg);
    expect(baseline.plan.entries.length).toBe(2);

    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    const hdrBody = cascadeRoot({ display: "block" }, [fixedBlock("h0", 130)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const tree = build(root, cfg, bodies);

    // 1 block/page ⇒ 4 pages, strictly more than baseline's 2.
    expect(tree.plan.entries.length).toBe(4);
    expect(tree.plan.entries.length).toBeGreaterThan(baseline.plan.entries.length);
    // First body block pushed to 130.
    const body0 = tree.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(130);
  });
});

// ---------------------------------------------------------------------------
// (3) Slot natural height (UNCAPPED) — never clipped to the margin band.
// ---------------------------------------------------------------------------

describe("growing-slot — (3) slot natural height (uncapped)", () => {
  it("a multi-line header taller than the margin band lays at its NATURAL height, all lines present", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    // Container header body with 3 paragraph children ⇒ 3 × 16 = 48px natural.
    const hdrBody = cascadeRoot({ display: "block" }, [
      paragraph("h0", 1),
      paragraph("h1", 1),
      paragraph("h2", 1),
    ]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    // Margin band is only 10px; header 48px must NOT be clipped.
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    const hdr = tree.getPage(0).headerSlot;
    expect(hdr).not.toBeNull();
    if (hdr === null) throw new Error("header slot null");
    expect(hdr.blockSize).toBe(48); // NOT clipped to 10
    expect(hdr.children.length).toBe(3); // all three lines present
    // body pushed to effectiveTopInset = 48.
    const body0 = tree.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// (4) Re-pagination on header EDIT (de-risk the measure reuse gate).
// ---------------------------------------------------------------------------

describe("growing-slot — (4) re-pagination when the header grows (reuse gate)", () => {
  it("growing the header body (height 0→tall) re-paginates to the new page count, not the stale one", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    const cfg = pageConfig(300, 10);

    // Cycle A: SHORT header (fits the margin band): natural height 8 < margin 10.
    const shortHdr = cascadeRoot({ display: "block" }, [fixedBlock("h0", 8)]);
    const treeA = build(root, cfg, new Map([[hdrId, shortHdr]]));
    // effectiveTopInset = max(10, 8) = 10 ⇒ content 280 ⇒ 2 blocks/page ⇒ 2 pages.
    expect(treeA.plan.entries.length).toBe(2);

    // Cycle B: GROW the header (NEW cascaded ref) to 130px so 1 block/page.
    // Rebuild with treeA as prevTree — the reuse gate MUST re-fit, NOT carry the
    // stale 2-page plan forward.
    const tallHdr = cascadeRoot({ display: "block" }, [fixedBlock("h0", 130)]);
    expect(tallHdr).not.toBe(shortHdr);
    const treeB = build(root, cfg, new Map([[hdrId, tallHdr]]), treeA);
    expect(treeB.plan.entries.length).toBe(4); // 1 block/page ⇒ 4 pages, NOT the stale 2.
    const body0 = treeB.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(130);
  });
});

// ---------------------------------------------------------------------------
// (5) Cursor-corner fix: a pixel in the overflowed header region resolves to a
// header line, NOT clipped away. We assert the header slot OCCUPIES the region
// beyond the old margin band (so caret/hit-test machinery, which reads the
// slot box geometry, can resolve there).
// ---------------------------------------------------------------------------

describe("growing-slot — (5) overflowed header line occupies its natural region", () => {
  it("a header line below the old margin band is within the slot box (not clipped)", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    const hdrBody = cascadeRoot({ display: "block" }, [
      paragraph("h0", 1),
      paragraph("h1", 1),
    ]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, new Map([[hdrId, hdrBody]]));

    const hdr = tree.getPage(0).headerSlot;
    if (hdr === null) throw new Error("header slot null");
    // Header is 32px tall (2 lines). The SECOND line sits at blockOffset 16,
    // i.e. BELOW the old 10px margin band — it must exist (not clipped).
    expect(hdr.blockSize).toBe(32);
    expect(hdr.children.length).toBe(2);
    const secondLine = hdr.children[1];
    if (secondLine === undefined) throw new Error("second header line missing");
    // The second line is at y=16, beyond the 10px band: previously clipped/lost.
    expect(secondLine.blockOffset).toBe(16);
    expect(secondLine.blockOffset).toBeGreaterThan(cfg.pageMargins.blockStart);
  });
});

// ---------------------------------------------------------------------------
// (6) Footer symmetry: a tall footer pushes the body bottom UP; the footer sits
// at its natural height ending at the page bottom.
// ---------------------------------------------------------------------------

describe("growing-slot — (6) footer grows upward (symmetric)", () => {
  it("footer height > bottom margin: footer origin = pageBlockSize − effectiveBottomInset, body bottom pushed up", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const ftrId = "ftr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { footerBlockId: ftrId });
    const ftrBody = cascadeRoot({ display: "block" }, [fixedBlock("f0", 130)]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, new Map([[ftrId, ftrBody]]));

    // effectiveBottomInset = max(10, 130) = 130. Content [10, 170] = 160 ⇒ 1
    // block/page ⇒ 4 pages.
    expect(tree.plan.entries.length).toBe(4);
    const p0 = tree.getPage(0);
    // Body's first block at the raw TOP margin (10; no header).
    const body0 = p0.children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(10);
    // Footer slot origin = pageBlockSize − effectiveBottomInset = 300 − 130 = 170.
    const ftr = p0.footerSlot;
    if (ftr === null) throw new Error("footer slot null");
    expect(ftr.blockOffset).toBe(170);
    expect(ftr.blockSize).toBe(130); // natural height, not clipped to 10
    // Footer ends at page bottom (170 + 130 = 300).
    expect(ftr.blockOffset + ftr.blockSize).toBe(cfg.pageBlockSize);
  });
});

// ---------------------------------------------------------------------------
// (M2) Landscape-section header: a section overriding inline-size lays its
// header at the SECTION's own inline width, so a soft-wrapping header wraps to a
// different line count (and natural height) than it would at the doc-wide width.
// The section's body origin must reflect the LANDSCAPE-width header height.
// ---------------------------------------------------------------------------

describe("growing-slot — (M2) landscape section header uses the section's own inline width", () => {
  it("the section's header wraps at the section inline-size; its inset = that wrapped height", () => {
    // Mock shaper: words/line = floor((contentInlineSize + 8) / 16).
    // Doc-wide (narrow): pageInlineSize 200, margins 15/15 ⇒ content 170 ⇒
    //   floor(178/16) = 11 words/line. Header 24 words ⇒ ceil(24/11) = 3 lines = 48px.
    // Landscape (wide): pageInlineSize 600, margins 15/15 ⇒ content 570 ⇒
    //   floor(578/16) = 36 words/line. Header 24 words ⇒ 1 line = 16px.
    // The section header MUST wrap at the LANDSCAPE width ⇒ 16px, NOT 48px.
    const docWide = pageConfig(400, 10, 200); // narrow, tall page
    const hdrId = "sec-hdr" as BlockId;

    // The doc body: one block, then a section (display:contents) with its own
    // landscape geometry + header id. The section marker drives buildSectionPlan.
    const sectionChild = createElementBox(
      "sec",
      { display: "contents" } as Style,
      [fixedBlock("s0", 100), fixedBlock("s1", 100)],
      {
        blockType: "section",
        pageInlineSize: 600, // landscape: wider than doc-wide 200
        headerBlockId: hdrId,
      },
    );
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 100), sectionChild]);

    // Header body: a 24-word soft-wrapping paragraph. Container root (the
    // template-body shape) holding the paragraph.
    const hdrBody = cascadeRoot({ display: "block" }, [softParagraph("h0", 24)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);

    const tree = build(root, docWide, bodies);

    // Sanity: laying the SAME header at the narrow doc-wide width yields 48px
    // (3 lines), so a wrong (doc-wide-width) inset would push the section body
    // to 48 — proving the test discriminates.
    const narrowCtx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);
    const narrowContent = docWide.pageInlineSize - 15 - 15; // 170
    const narrowSlotCtx: LayoutContext = { ...narrowCtx, containingInlineSize: narrowContent };
    const { box: narrowBox } = layoutBlock(hdrBody, 0, 0, narrowSlotCtx, shaper(), undefined, {
      availableBlockSize: Number.MAX_SAFE_INTEGER,
      pageIndex: 0,
      resumeFrom: null,
    });
    expect(narrowBox?.blockSize).toBe(48);

    // Find the first page owned by the SECTION (the page whose entry's
    // activeSectionId is the section id).
    const sectionPageIndex = tree.plan.entries.findIndex((e) => e.activeSectionId === ("sec" as BlockId));
    expect(sectionPageIndex).toBeGreaterThanOrEqual(0);
    const secEntry = tree.plan.entries[sectionPageIndex];
    if (secEntry === undefined) throw new Error("expected a section plan entry");
    // The section's effective top inset = max(margin 15, landscape-width header
    // 16) = 16 — wrapped at the LANDSCAPE width, NOT the narrow 48.
    expect(secEntry.effectiveTopInset).toBe(16);
    // The materialized section page's body origin reflects that 16px inset.
    const secBody0 = tree.getPage(sectionPageIndex).children[0];
    if (secBody0 === undefined) throw new Error("no section body box");
    expect(secBody0.blockOffset).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// (M3) Full-build / RESIZE path: dispatch.layoutTree (no prevTree) must thread
// the cascaded bodies so a tall-header doc paginates with the GROWN insets —
// body origin = effectiveTopInset, page count matches the incremental producer.
// ---------------------------------------------------------------------------

describe("growing-slot — (M3) full-build path threads bodies (C1)", () => {
  it("layoutTree (full build) with a tall header pushes the body + matches the incremental page count", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    const hdrBody = cascadeRoot({ display: "block" }, [fixedBlock("h0", 130)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const cfg = pageConfig(300, 10);

    // Full build via dispatch.layoutTree, threading the bodies (the resize path).
    const full = layoutTree(root, cfg.pageInlineSize, shaper(), cfg, bodies);
    expect(full.type).toBe("virtual-root");
    const fullTree = full as VirtualLayoutTree;

    // Incremental producer (the per-keystroke path) for comparison.
    const incremental = build(root, cfg, bodies);

    // Same page count both ways (1 block/page ⇒ 4 pages).
    expect(fullTree.plan.entries.length).toBe(4);
    expect(fullTree.plan.entries.length).toBe(incremental.plan.entries.length);
    // Body origin = effectiveTopInset (130), not the raw 10px margin.
    const body0 = fullTree.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(130);
    // And the WITHOUT-bodies full build (the old resize behavior) would NOT push
    // the body — proving the threading is load-bearing.
    const fullNoBodies = layoutTree(root, cfg.pageInlineSize, shaper(), cfg) as VirtualLayoutTree;
    const noBody0 = fullNoBodies.getPage(0).children[0];
    if (noBody0 === undefined) throw new Error("no body box (no-bodies)");
    expect(noBody0.blockOffset).toBe(10);
    expect(fullNoBodies.plan.entries.length).toBe(2); // no push ⇒ 2 blocks/page ⇒ 2 pages
  });
});
