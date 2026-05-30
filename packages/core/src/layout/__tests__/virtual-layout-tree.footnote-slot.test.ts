// packages/core/src/layout/__tests__/virtual-layout-tree.footnote-slot.test.ts
//
// FN-4.3 — the footnote SLOT renders through buildVirtualPaginatedTree → getPage.
// These drive the REAL producer (cascade → metas → measurePass → resolveFootnotes
// → makeVirtualLayoutTree) and assert GEOMETRY (slot blockOffset, separator +
// body lines, reduced body content area, fingerprint re-materialization) per
// CLAUDE.md — not just counts. Part D also covers the D9 multi-section per-page
// geometry fix in resolveFootnotes directly (a 2-section plan whose swept page
// derives section-2 geometry, not section-1's).

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox, RenderNode } from "../../render/render-node";
import type { BlockId } from "../../state";
import type { Style } from "../../styles";
import type { PageConfig } from "../page-config";
import type { FootnoteAnchorRef } from "../../footnotes";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass, type SlotInsets } from "../measure-pass";
import type { SectionPlan } from "../section-plan";
import { flattenContents } from "../group-children";
import { resolveFootnotes, FOOTNOTE_SEPARATOR_HEIGHT } from "../resolve-footnotes";

const SHAPER = createMockShaper(8, 16); // 16px line-height, 8px/char.

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

function cascadeRoot(children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", { display: "block" } as Style, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function cascadeBody(body: ElementBox): ElementBox {
  const c = cascadePass(body);
  if (c.type !== "element") throw new Error("cascadePass returned non-element");
  return c;
}

function anchor(blockId: string, contentBlockId: string): FootnoteAnchorRef {
  return {
    blockId: blockId as BlockId,
    contentBlockId: contentBlockId as BlockId,
    sectionId: null,
  };
}

// No-margin page, 64px content ⇒ 4 single-line (16px) paragraphs per page.
const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 64,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function build(
  root: ElementBox,
  embedContents: ReadonlyMap<BlockId, ElementBox>,
  footnoteAnchors: readonly FootnoteAnchorRef[],
  pageConfig: PageConfig = PAGE,
) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  return buildVirtualPaginatedTree(
    root,
    ctx,
    SHAPER,
    pageConfig,
    undefined,
    new Map(), // cascadedTemplateContents (no header/footer)
    embedContents,
    footnoteAnchors,
  );
}

describe("FN-4.3 — PageBox.footnoteSlot rendered via buildVirtualPaginatedTree → getPage", () => {
  it("(a) a page with a footnote has a slot at pageBlockSize − bottomInset − slotHeight, holding a separator + body line; the body area is reduced (a block is evicted)", () => {
    // 4 paras fit one no-footnote page (64 / 16). A footnote on b0 reserves a
    // 1-line body (16) + separator (13) = 29px slot ⇒ 35px body area ⇒ only 2
    // paras fit on page 0, evicting b2,b3 to a new page.
    const root = cascadeRoot([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const fnRootId = "fn0" as BlockId;
    const embed = new Map<BlockId, ElementBox>([[fnRootId, cascadeBody(fnBody("fn0", 1))]]);
    const anchors = [anchor("b0", "fn0")];

    const tree = build(root, embed, anchors);

    // The footnote evicted blocks ⇒ more than one page.
    expect(tree.plan.entries.length).toBeGreaterThan(1);
    expect(tree.plan.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29
    expect(tree.plan.entries[0].children.length).toBe(2); // body area 35 ⇒ 2 paras

    const page0 = tree.getPage(0);
    const slot = page0.footnoteSlot;
    expect(slot).not.toBeNull();
    if (slot === null) throw new Error("unreachable");

    // Slot positioned (D1) at pageBlockSize − bottomInset − slotHeight.
    const expectedSlotTop = PAGE.pageBlockSize - 0 - (16 + FOOTNOTE_SEPARATOR_HEIGHT); // 64 − 29 = 35
    expect(slot.blockOffset).toBe(expectedSlotTop);
    expect(slot.blockSize).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    // Slot is BELOW the body content (2 lines = 32px ends at 32 ≤ 35) and ABOVE
    // the footer (page bottom = 64; slot ends at 35 + 29 = 64).
    expect(slot.blockOffset).toBeGreaterThanOrEqual(2 * 16); // body ends at 32
    expect(slot.blockOffset + slot.blockSize).toBe(PAGE.pageBlockSize);

    // Slot children: a separator rule (height 13) then the 1-line body (16).
    expect(slot.children.length).toBe(2);
    const sep = slot.children[0];
    expect(sep.blockOffset).toBe(0);
    expect(sep.blockSize).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    const body = slot.children[1];
    expect(body.blockOffset).toBe(FOOTNOTE_SEPARATOR_HEIGHT); // stacked below separator
    expect(body.blockSize).toBe(16); // one line

    // The slot is ALSO appended to page children (paint/line-collection see it).
    expect(page0.children).toContain(slot);

    // Page 1 (eviction target) carries NO footnote slot.
    const page1 = tree.getPage(1);
    expect(page1.footnoteSlot).toBeNull();
  });

  it("(b) a doc with no footnotes has footnoteSlot === null on every page", () => {
    const root = cascadeRoot([fnPara("b0"), fnPara("b1")]);
    const tree = build(root, new Map(), []);
    expect(tree.plan.entries.length).toBe(1);
    expect(tree.getPage(0).footnoteSlot).toBeNull();
  });

  it("(c) editing a footnote body changes the fingerprint → the page re-materializes (no stale slot reuse); the new slot reflects the new body", () => {
    // Build tree A with a 1-line body (slot 29). Then tree B with the SAME doc
    // but a re-cascaded 2-line body (new ref, slot 45). The carry-forward memo
    // must NOT reuse page 0's stale slot.
    const root = cascadeRoot([fnPara("b0"), fnPara("b1")]);
    const anchors = [anchor("b0", "fnE")];

    const bodyA = cascadeBody(fnBody("fnE", 1));
    const embedA = new Map<BlockId, ElementBox>([["fnE" as BlockId, bodyA]]);
    const treeA = build(root, embedA, anchors);
    // Materialize page 0 in A so the carry-forward has a candidate to reuse.
    const pageA0 = treeA.getPage(0);
    expect(pageA0.footnoteSlot?.blockSize).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    // Tree B: a freshly-cascaded 2-line body (different ElementBox ref) for the
    // SAME id ⇒ the slot's body ref changes ⇒ fingerprint differs ⇒ no reuse.
    const bodyB = cascadeBody(fnBody("fnE", 2));
    expect(bodyB).not.toBe(bodyA);
    const embedB = new Map<BlockId, ElementBox>([["fnE" as BlockId, bodyB]]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, PAGE.pageInlineSize);
    const treeB = buildVirtualPaginatedTree(
      root, ctx, SHAPER, PAGE, treeA, new Map(), embedB, anchors,
    );

    const pageB0 = treeB.getPage(0);
    // NOT reused by reference (the slot body changed).
    expect(pageB0).not.toBe(pageA0);
    // The new slot reflects the 2-line body: 2 × 16 + separator = 45.
    expect(pageB0.footnoteSlot?.blockSize).toBe(16 + 16 + FOOTNOTE_SEPARATOR_HEIGHT); // 45
  });
});

// ===========================================================================
// Part D — D9: multi-section per-page geometry in resolveFootnotes. A footnote
// that shifts blocks across a section boundary must give the swept page the
// CORRECT section's geometry (pageConfig + insets), not section-1's. We drive
// resolveFootnotes directly with a hand-built 2-section SectionPlan + slotInsets.
// ===========================================================================

describe("FN-4.3 D9 — multi-section footnote geometry derives from sectionStateAt, not by-page-number", () => {
  it("a footnote on a section-1 page shifts a block onto a section-2 page whose body availableBlockSize reflects SECTION 2's geometry", () => {
    // Doc: 6 single-line paras. Section 2 begins at top-level index 4 (b4).
    // docWide (section 1): 64px page, 0 margins ⇒ 64px body area.
    // Section 2: a TALLER 96px page with 20/20 margins ⇒ 56px body area.
    const docWide: PageConfig = PAGE; // section 1
    const section2Cfg: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 96,
      pageMargins: { blockStart: 20, blockEnd: 20, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    const SECTION2_ID = "sec2" as BlockId;

    const children = [
      fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3"),
      fnPara("b4"), fnPara("b5"),
    ];
    const root = cascadeRoot(children);
    const rootChildren = flattenContents(root.children);

    // Hand-built section plan: section 1 (implicit, null) for indices 0..3,
    // section 2 (sec2, with its own geometry) from index 4.
    const sectionPlan: SectionPlan = {
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 4, sectionId: SECTION2_ID, pageConfig: section2Cfg },
      ],
    };

    const metas = buildBlockFitMetas(root, SHAPER, docWide.pageInlineSize);
    // Raw plan over the section plan: section 1 = 4 paras/page (b0..b3 on page
    // 0), section 2 forced to a new page (b4,b5) at its 56px body area ⇒
    // 3 paras would fit but only 2 exist ⇒ b4,b5 on page 1.
    const rawPlan = measurePass(metas, docWide, sectionPlan, rootChildren);
    expect(rawPlan.entries.length).toBe(2);
    expect(rawPlan.pageIndexOfBlock("b4")).toBe(1); // b4 begins section-2 page

    // slotInsets: empty (no headers/footers) ⇒ insets fall back to each
    // section's raw margins, exactly as measurePass does.
    const slotInsets: SlotInsets = new Map();

    // A footnote on b3 (section-1 page 0). Its 1-line slot (29) reduces page 0's
    // body to 35px ⇒ only 2 paras fit ⇒ b2,b3 evicted. b2,b3 are STILL section 1
    // (indices 2,3 < 4), so they form a new section-1 page; b4 stays section 2.
    const embed = new Map<BlockId, ElementBox>([
      ["fn3" as BlockId, cascadeBody(fnBody("fn3", 1))],
    ]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);

    const out = resolveFootnotes(
      rawPlan, metas, sectionPlan, rootChildren,
      embed, [anchor("b3", "fn3")], ctx, SHAPER, slotInsets, docWide,
    );

    // Find the page that begins section 2 (startIndex 4 ⇒ b4).
    const sec2PageIndex = out.entries.findIndex((e) => e.startIndex === 4);
    expect(sec2PageIndex).toBeGreaterThanOrEqual(0);
    const sec2Page = out.entries[sec2PageIndex];

    // D9: the swept section-2 page's geometry comes from SECTION 2's config —
    // pageBlockSize 96 (not docWide 64), and insets from its 20/20 margins.
    expect(sec2Page.pageConfig.pageBlockSize).toBe(96);
    expect(sec2Page.blockSize).toBe(96);
    expect(sec2Page.effectiveTopInset).toBe(20);
    expect(sec2Page.effectiveBottomInset).toBe(20);
    // Its body fit against section-2's 56px content area, NOT section-1's 64px.
    // (b4,b5 = 2 paras = 32px, well within 56 ⇒ both fit, no further eviction.)
    expect(sec2Page.children.map((c) => c.key)).toEqual(["b4", "b5"]);
    // The section-2 page carries NO footnote (the footnote stayed on section 1).
    expect(sec2Page.footnoteSlotHeight).toBe(0);

    // And the geometry came from the SECTION active at startIndex (sectionStateAt),
    // which is sec2 — not the by-page-number raw entry (whose section-2 page also
    // happens to be index 1 here, but the derivation is section-correct).
    expect(sec2Page.activeSectionId).toBe(SECTION2_ID);
  });
});
