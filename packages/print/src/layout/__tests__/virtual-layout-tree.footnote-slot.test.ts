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
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import type { LayoutBox } from "../layout-box";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass, type SlotInsets } from "../measure-pass";
import type { SectionPlan } from "../section-plan";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";
import { flattenContents } from "../group-children";
import { collectLineBoxes, type AbsoluteLineBox } from "../../cursor/line-flatten";
import {
  resolveFootnotes,
  FOOTNOTE_SEPARATOR_HEIGHT,
  FOOTNOTE_BODY_INDENT,
  FOOTNOTE_MARKER_GAP,
} from "../resolve-footnotes";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER = createMockShaper(8, 16); // 16px line-height, 8px/char.

/** A single-line paragraph (block whose only content is a text run) → 16px. */
function fnPara(key: string, text = "x"): ElementBox {
  return createElementBox(key, { display: "block" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/**
 * A footnote body: a container block holding `lines` single-line paragraphs.
 * `markerText` (the leading number, e.g. "1.") is set on the body ROOT style —
 * exactly as `footnoteBodyComponent` does from `ctx.footnoteNumber` — so the slot
 * emits the leading-number MarkerBox (#415).
 */
function fnBody(key: string, lines: number, markerText?: string): ElementBox {
  const children: RenderNode[] = [];
  for (let i = 0; i < lines; i++) children.push(fnPara(`${key}-p${i}`));
  const style: Style = markerText !== undefined
    ? ({ display: "block", markerText } as Style)
    : ({ display: "block" } as Style);
  return createElementBox(key, style, children);
}

/**
 * A footnote body whose single paragraph holds ONE long text run (not separate
 * one-word paragraphs). `markerText` is set on the body ROOT so the slot emits
 * the leading-number gutter. Used to straddle the gutter wrap boundary: a run
 * that fits one line at the FULL content width but wraps once the gutter is
 * subtracted.
 */
function fnBodyRun(key: string, text: string, markerText: string): ElementBox {
  const para = createElementBox(`${key}-p0`, { display: "block" } as Style, [
    createTextBox(`${key}-p0-t`, {}, text),
  ]);
  return createElementBox(key, { display: "block", markerText } as Style, [para]);
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

/**
 * POSITIVE separator-absence assertion (follow-up B): the slot's ONLY child
 * kinds are body block fragments (`type: "block"`) and leading-number markers
 * (`type: "marker"`). NO child carries a truthy `footnoteSeparator`, AND there is
 * no extra block child beyond `expectedBodyCount` real body fragments. This is
 * strictly stronger than `!children.some(footnoteSeparator === true)` — that weak
 * detector passes even if a separator box with falsy/empty metadata were emitted.
 */
function assertNoSeparatorOnlyBodies(slot: LayoutBox, expectedBodyCount: number): void {
  if (!("children" in slot)) throw new Error("slot has no children");
  const blockChildren = slot.children.filter((c) => c.type === "block");
  // Every block-type child is a real body fragment (no separator metadata at all,
  // truthy OR falsy).
  for (const c of blockChildren) {
    const md = "metadata" in c ? c.metadata : undefined;
    expect(md === undefined || !("footnoteSeparator" in md)).toBe(true);
  }
  // Exactly the expected number of body fragments — no extra separator block.
  expect(blockChildren.length).toBe(expectedBodyCount);
  // And the only non-block children are markers (no stray box of another type
  // carrying a separator flag).
  for (const c of slot.children) {
    if (c.type === "block" || c.type === "marker") continue;
    throw new Error(`unexpected slot child of type ${c.type}`);
  }
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
  direction: "ltr" | "rtl" = "ltr",
) {
  // The materialize pass reads `ctx.direction` (the closure ctx) to place the
  // marker gutter on the inline-start (LTR) or inline-end (RTL). Drive it here.
  const ctx = makeRootContext(
    { ...INITIAL_COMPUTED_STYLE, direction },
    pageConfig.pageInlineSize,
  );
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
    const embed = new Map<BlockId, ElementBox>([[fnRootId, cascadeBody(fnBody("fn0", 1, "1."))]]);
    const anchors = [anchor("b0", "fn0")];

    const tree = build(root, embed, anchors);

    // The footnote evicted blocks ⇒ more than one page.
    expect(tree.plan.entries.length).toBeGreaterThan(1);
    expect(nth(tree.plan.entries, 0, "page entry").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29
    expect(nth(tree.plan.entries, 0, "page entry").children.length).toBe(2); // body area 35 ⇒ 2 paras

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

    // Slot children: NO separator box (removed — user directive), just the
    // 1-line body (16). The separator BAND is still reserved as a plain gap, so
    // the body still starts below it. There is also a leading-number MARKER box
    // (Bug #415) — a sibling of the body, NOT counted toward the body line.
    const body = slot.children.find((c) => c.type === "block");
    expect(body).toBeDefined();
    if (body === undefined) throw new Error("footnote body box missing");
    expect(body.blockOffset).toBe(FOOTNOTE_SEPARATOR_HEIGHT); // stacked below the gap
    expect(body.blockSize).toBe(16); // one line
    // No separator box is emitted any more (positive check — follow-up B): the
    // ONLY slot children are the single body fragment + its leading-number marker.
    assertNoSeparatorOnlyBodies(slot, 1);
    // The body's content is INSET by the FIXED list-matching hanging indent
    // (FOOTNOTE_BODY_INDENT = 30, the numbered-list LIST_INDENT): the body text
    // starts at x=30, the number "1." HANGS in the 30px gutter, right-aligned
    // against the text edge — exactly like a numbered list item.
    expect(body.inlineOffset).toBe(FOOTNOTE_BODY_INDENT); // body text at the fixed 30px indent
    const marker = slot.children.find((c) => c.type === "marker");
    expect(marker).toBeDefined();
    if (marker === undefined) throw new Error("footnote leading-number marker missing");
    // Marker "1." = 2 chars × 8px = 16px. It hangs at `indent − markerWidth − gap`
    // = 30 − 16 − 4 = 10 — right-aligned against the text edge (its right edge at
    // 10 + 16 = 26, one gap (4) short of the text at 30), NOT at inline-start 0.
    expect(marker.inlineSize).toBe(16);
    expect(marker.inlineOffset).toBe(FOOTNOTE_BODY_INDENT - 16 - FOOTNOTE_MARKER_GAP); // 10
    expect(marker.inlineOffset).toBe(10);
    // Marker PRECEDES the body text in LTR reading order (its right edge is left
    // of the text edge): hanging-indent, consistent regardless of number width.
    expect(marker.inlineOffset + marker.inlineSize).toBeLessThanOrEqual(body.inlineOffset);
    // The slot wrapper sits at the page content inline-start (0 here, no margins).
    expect(slot.inlineOffset).toBe(PAGE.pageMargins.inlineStart);

    // DA3: the footnote slot is a PURE NAMED field — NOT in `page.children`
    // (exactly like `headerSlot` / `footerSlot`). The three DOM walkers reach it
    // BY NAME, so it must NOT also appear in children (that would double-process
    // it: double-paint, double-collect). The named field is the single source.
    expect(page0.children).not.toContain(slot);

    // …and `collectLineBoxes` (the line-collection walker) reaches the slot's
    // body line BY NAME and emits it EXACTLY ONCE. The footnote body's owner
    // block id is `${fnRootId}-p0` (the fnBody's single paragraph). It is a
    // distinct context from the page body, so it must appear once — not zero
    // (dropped because no longer in children) and not twice (double-walked).
    const lines: AbsoluteLineBox[] = [];
    collectLineBoxes(page0, 0, 0, lines);
    const slotLines = lines.filter((l) => l.line.ownerBlockId === "fn0-p0");
    expect(slotLines.length).toBe(1);

    // Page 1 (eviction target) carries NO footnote slot.
    const page1 = tree.getPage(1);
    expect(page1.footnoteSlot).toBeNull();
  });

  it("(a2) a wrapping numbered body is laid out at the SAME gutter-narrowed width in BOTH the measure pass and the materialize pass — the slot height fits the wrapped body, no silent drop", () => {
    // The CRITICAL bug: `computeSlotLayout` (measure/partition) lays the body at
    // the FULL content width while `materializePage` (#415) narrows it by the
    // marker gutter. For a body that fits ONE line at full width but WRAPS once
    // the gutter is subtracted, the two passes disagree: measure under-computes
    // `footnoteSlotHeight` (1 line) while materialize produces 2 lines, which the
    // `bodyBox.blockSize <= remaining` guard then DROPS (prod) / THROWS (dev).
    //
    // Geometry: content inline-size 600px, mock shaper 8px/char ⇒ 75 chars/line at
    // full width. The body's fixed list-matching gutter is FOOTNOTE_BODY_INDENT =
    // 30px (independent of marker width) ⇒ narrowed width 570px ⇒ 71 chars/line. A
    // 74-char run (with a soft break so it CAN wrap) is 592px: ≤ 600 (one line full
    // width) but > 570 (two lines at the narrowed list-indent width).
    const SEG_A = "a".repeat(40);
    const SEG_B = "b".repeat(33);
    const runText = `${SEG_A} ${SEG_B}`; // 40 + space + 33 = 74 chars = 592px
    expect(runText.length).toBe(74);

    // A single-block doc (b0) anchoring the footnote — keep the body page simple.
    const root = cascadeRoot([fnPara("b0")]);
    const fnId = "fnWrap" as BlockId;
    const embed = new Map<BlockId, ElementBox>([
      [fnId, cascadeBody(fnBodyRun("fnWrap", runText, "1."))],
    ]);
    const anchors = [anchor("b0", "fnWrap")];

    // Pre-fix: building the tree + materializing page 0 THROWS in dev (the
    // narrowed 2-line body overruns the measure pass's 1-line slot). Post-fix:
    // both passes agree at the narrowed width, so the slot reserves 2 lines.
    const tree = build(root, embed, anchors);

    // The starting page reserves the gutter-narrowed (2-line) body: 2×16 + 13 = 45.
    const startPage = tree.plan.entries.find((e) =>
      e.footnoteContentBlockIds.includes(fnId),
    );
    expect(startPage).toBeDefined();
    if (startPage === undefined) throw new Error("unreachable");
    expect(startPage.footnoteSlotHeight).toBe(2 * 16 + FOOTNOTE_SEPARATOR_HEIGHT); // 45

    const startPageIndex = tree.plan.entries.indexOf(startPage);
    const page = tree.getPage(startPageIndex);
    const slot = page.footnoteSlot;
    expect(slot).not.toBeNull();
    if (slot === null) throw new Error("unreachable");

    // The body is FULLY rendered in the slot (not dropped): a block-type child
    // with TWO lines, and the slot height the plan reserved fits it.
    const body = slot.children.find((c) => c.type === "block");
    expect(body).toBeDefined();
    if (body === undefined) throw new Error("footnote body box missing");
    let bodyLines = 0;
    const countLines = (b: LayoutBox): void => {
      if (b.type === "line") {
        bodyLines += 1;
        return;
      }
      if ("children" in b) for (const c of b.children) countLines(c);
    };
    countLines(body);
    expect(bodyLines).toBe(2); // wrapped at the narrowed width
    expect(body.blockSize).toBe(2 * 16); // both lines rendered
    // Measure + materialize AGREE: the body box fits within the reserved slot
    // (its bottom edge ≤ slot height), so nothing is silently dropped.
    expect(body.blockOffset + body.blockSize).toBeLessThanOrEqual(slot.blockSize);
    expect(slot.blockSize).toBe(startPage.footnoteSlotHeight);

    // The leading-number marker is present (fresh body) and the body text is
    // inset by the fixed list-matching indent (30).
    const marker = slot.children.find((c) => c.type === "marker");
    expect(marker).toBeDefined();
    expect(body.inlineOffset).toBe(FOOTNOTE_BODY_INDENT);
    // Positive separator-absence (follow-up B): exactly ONE body fragment + marker.
    assertNoSeparatorOnlyBodies(slot, 1);
  });

  it("(a3) RTL — the body sits at slot-local inlineOffset 0 (narrowed by the fixed indent) and the leading-number marker HANGS just inline-end of the body's content edge inside the right-hand gutter, preceding the text in reading order", () => {
    // Mirror of (a) but RTL: same 1-line numbered fresh body, same fixed
    // list-matching gutter (FOOTNOTE_BODY_INDENT = 30, direction-independent), but
    // the gutter is on the INLINE-END (right) edge. The body content box stays at
    // slot-local inlineOffset 0 (RTL does not inset it — the gutter is on the
    // right) and is narrowed to `effContentInlineSize − 30` = 570. The marker
    // HANGS just inline-end (right) of the body's right content edge (570), one gap
    // (4) clear of it: markerInlineOffset = (600 − 30) + 4 = 574 — the mirror of
    // LTR's `indent − markerWidth − gap`. Marker "1." = 2 chars × 8px = 16px ⇒
    // markerWidth 16; its right edge 574 + 16 = 590 stays within the 600 content
    // edge (inside the reserved 30px right gutter), and it reads BEFORE the text in
    // RTL reading order.
    const root = cascadeRoot([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const fnRootId = "fn0" as BlockId;
    const embed = new Map<BlockId, ElementBox>([[fnRootId, cascadeBody(fnBody("fn0", 1, "1."))]]);
    const anchors = [anchor("b0", "fn0")];

    const tree = build(root, embed, anchors, PAGE, "rtl");

    // Same slot geometry as the LTR case — the footnote evicted blocks.
    expect(nth(tree.plan.entries, 0, "page entry").footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    const page0 = tree.getPage(0);
    const slot = page0.footnoteSlot;
    expect(slot).not.toBeNull();
    if (slot === null) throw new Error("unreachable");

    const body = slot.children.find((c) => c.type === "block");
    expect(body).toBeDefined();
    if (body === undefined) throw new Error("footnote body box missing");
    const marker = slot.children.find((c) => c.type === "marker");
    expect(marker).toBeDefined();
    if (marker === undefined) throw new Error("footnote leading-number marker missing");

    // RTL: the body content box sits at slot-local inlineOffset 0 (NOT inset — the
    // gutter is on the right), narrowed to `effContentInlineSize − 30` = 570. This
    // is the load-bearing RTL assertion: in LTR the body is inset (= 30); here it
    // must be 0 with the narrowing applied as a width reduction instead.
    expect(body.inlineOffset).toBe(0);
    expect(body.inlineSize).toBe(slot.inlineSize - FOOTNOTE_BODY_INDENT); // 570

    // The marker HANGS just inline-end of the body's right content edge (570),
    // one gap clear of it, inside the reserved 30px right gutter:
    // markerInlineOffset = (effContentInlineSize − indent) + gap = 570 + 4 = 574 —
    // the mirror of LTR's `indent − markerWidth − gap`. (Would FAIL if the RTL
    // marker regressed to 0/LTR placement, or to the old `content − markerWidth`.)
    const markerWidth = marker.inlineSize;
    expect(markerWidth).toBe(16);
    const bodyContentEdge = slot.inlineSize - FOOTNOTE_BODY_INDENT; // 570
    const expectedMarkerOffset = bodyContentEdge + FOOTNOTE_MARKER_GAP; // 574
    expect(marker.inlineOffset).toBe(expectedMarkerOffset);
    expect(marker.inlineOffset).toBe(574);

    // Marker PRECEDES the body text in RTL reading order and stays WITHIN the
    // reserved right gutter: its left edge is at/right of the body's right content
    // edge (outboard of the text), and its right edge stays within the content box.
    expect(marker.inlineOffset).toBeGreaterThanOrEqual(body.inlineOffset + body.inlineSize);
    expect(marker.inlineOffset + markerWidth).toBeLessThanOrEqual(slot.inlineSize); // within the gutter (590 ≤ 600)

    // Still exactly one body fragment + its marker, no separator box.
    assertNoSeparatorOnlyBodies(slot, 1);
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 4, sectionId: SECTION2_ID, pageConfig: section2Cfg },
      ],
    };

    const metas = buildBlockFitMetas(root, SHAPER, undefined, docWide.pageInlineSize);
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
      embed, [anchor("b3", "fn3")], ctx, SHAPER, undefined, slotInsets, docWide,
    );

    // Find the page that begins section 2 (startIndex 4 ⇒ b4).
    const sec2PageIndex = out.entries.findIndex((e) => e.startIndex === 4);
    expect(sec2PageIndex).toBeGreaterThanOrEqual(0);
    const sec2Page = nth(out.entries, sec2PageIndex, "section-2 page entry");

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
