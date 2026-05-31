// packages/core/src/layout/__tests__/virtual-layout-tree.footnote-split.test.ts
//
// FN-5.5 — `materializePage` renders the INBOUND continuation list (E5) bounded
// by the shrinking slot area, gates the slot on `footnoteSlotHeight > 0` (E4),
// and the E6(b) fingerprint includes the inbound continuation (so editing a split
// body re-materializes BOTH the page-N slot AND the page-N+1 continuation).
//
// These drive the REAL producer (cascade → metas → measurePass → resolveFootnotes
// → makeVirtualLayoutTree) and assert GEOMETRY via getPage — the slot's separator
// + body line offsets, the cross-page no-overlap/no-loss partition, and the
// re-materialize-on-edit — per CLAUDE.md (test geometry, not just structure).

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
import type { LayoutBox } from "../layout-box";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { FOOTNOTE_SEPARATOR_HEIGHT } from "../resolve-footnotes";

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
  return { blockId: blockId as BlockId, contentBlockId: contentBlockId as BlockId, sectionId: null };
}

// No-margin page, 64px content ⇒ 4 single-line (16px) paragraphs per page.
// MIN_BODY_BLOCK_SIZE = 16, FOOTNOTE_SEPARATOR_HEIGHT = 13 ⇒ a footnote slot's
// body area is bounded to maxSlot = 64 − 16 − 13 = 35px ⇒ at most 2 footnote
// lines (32px) per page; a taller body splits + continues.
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
  prevTree?: ReturnType<typeof buildVirtualPaginatedTree>,
) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, PAGE.pageInlineSize);
  return buildVirtualPaginatedTree(
    root,
    ctx,
    SHAPER,
    PAGE,
    prevTree,
    new Map(), // cascadedTemplateContents (no header/footer)
    embedContents,
    footnoteAnchors,
  );
}

/** Count the LINE leaves (deepest line-boxes) under a layout box. */
function countLines(box: LayoutBox): number {
  if (box.type === "line") return 1;
  let n = 0;
  if ("children" in box) for (const c of box.children) n += countLines(c);
  return n;
}

describe("FN-5.5 — materializePage renders the inbound footnote continuation (E4/E5)", () => {
  it("(2-page split) a tall footnote body's first lines on page N's slot; its remainder leads page N+1's slot (separator at 0, continuation body below), no overlap/loss", () => {
    // A 5-line footnote on b0. Page 0's slot fits 2 lines (32px ≤ 35 maxSlot),
    // splitting the body: 2 lines on page 0, 3 carried forward. Page 0 keeps ≥1
    // body para (b0); the eviction pushes b1.. to a later page.
    const root = cascadeRoot([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const fnId = "fnSplit" as BlockId;
    const embed = new Map<BlockId, ElementBox>([[fnId, cascadeBody(fnBody("fnSplit", 5))]]);
    const anchors = [anchor("b0", "fnSplit")];

    const tree = build(root, embed, anchors);

    // Page 0 STARTS the footnote (no inbound), placing the first 2 lines.
    const e0 = tree.plan.entries[0];
    expect(e0.footnoteContinuation.length).toBe(0); // no inbound on the starting page
    expect(e0.footnoteContentBlockIds).toContain(fnId); // fresh body started here
    // Slot = 2 lines (32) + separator (13) = 45.
    expect(e0.footnoteSlotHeight).toBe(2 * 16 + FOOTNOTE_SEPARATOR_HEIGHT);

    const page0 = tree.getPage(0);
    const slot0 = page0.footnoteSlot;
    expect(slot0).not.toBeNull();
    if (slot0 === null) throw new Error("unreachable");
    // Slot positioned at pageBlockSize − slotHeight (0 bottom inset).
    expect(slot0.blockOffset).toBe(PAGE.pageBlockSize - e0.footnoteSlotHeight);
    expect(slot0.blockOffset + slot0.blockSize).toBe(PAGE.pageBlockSize);
    // separator at slot-local 0, then the partial body (2 lines = 32px) below it.
    expect(slot0.children[0].blockOffset).toBe(0);
    expect(slot0.children[0].blockSize).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    const body0 = slot0.children[1];
    expect(body0.blockOffset).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    const linesOnPage0 = countLines(body0);
    expect(linesOnPage0).toBe(2); // exactly the planned partial fit

    // The CONTINUATION page: find the entry whose inbound carries fnSplit.
    const contPageIndex = tree.plan.entries.findIndex((e) =>
      e.footnoteContinuation.some((c) => c.contentBlockId === fnId),
    );
    expect(contPageIndex).toBeGreaterThan(0);
    const eCont = tree.plan.entries[contPageIndex];
    // Its inbound list resumes fnSplit with a non-null token (mid-body split).
    const inbound = eCont.footnoteContinuation.find((c) => c.contentBlockId === fnId);
    expect(inbound).toBeDefined();
    expect(inbound?.resumeToken).not.toBeNull();

    const pageCont = tree.getPage(contPageIndex);
    const slotCont = pageCont.footnoteSlot;
    expect(slotCont).not.toBeNull();
    if (slotCont === null) throw new Error("unreachable");
    // separator at slot-local 0, continuation body at FOOTNOTE_SEPARATOR_HEIGHT.
    expect(slotCont.children[0].blockOffset).toBe(0);
    expect(slotCont.children[0].blockSize).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    const bodyCont = slotCont.children[1];
    expect(bodyCont.blockOffset).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    const linesOnCont = countLines(bodyCont);
    // EXACT continuation partition. Geometry: page 64, separator 13,
    // MIN_BODY_BLOCK_SIZE 16 ⇒ a slot SHARED with a body block bounds the body
    // area to 64 − 16 − 13 = 35px ⇒ 2 lines (32px) per shared-slot page. The
    // continuation page (index 1) still carries a body block (b1), so its slot is
    // the reduced 35px ⇒ 2 lines, NOT the full remainder. The 5-line body splits
    // 2 (page 0) + 2 (page 1) + 1 (page 2). Assert the continuation page renders
    // EXACTLY 2 — a partial-re-split regression that dropped a line here would
    // still satisfy a total==5 sum via the tail page, so the exact count is what
    // catches it.
    expect(linesOnCont).toBe(2);

    // No overlap, no loss: page-N's 2 lines + the continuation's lines together
    // cover ALL 5 lines (plus any further tail pages if 3 > 2 per page). Sum the
    // fnSplit lines across every page that renders it.
    let totalFnLines = 0;
    for (let i = 0; i < tree.plan.entries.length; i++) {
      const slot = tree.getPage(i).footnoteSlot;
      if (slot === null) continue;
      // Each slot child after the separator is a fnSplit body fragment on this
      // chain (this doc has exactly one footnote), so count all body lines.
      for (let ci = 1; ci < slot.children.length; ci++) {
        totalFnLines += countLines(slot.children[ci]);
      }
    }
    expect(totalFnLines).toBe(5); // every line rendered exactly once across pages
  });

  it("(continuation-only tail page) a footnote taller than the whole body run drains onto a tail page whose slot = separator + the continued body, no fresh bodies", () => {
    // One short body block b0 + a tall 6-line footnote on it. The body run ends
    // on page 0 (b0 placed); the footnote can't fully fit, so its remainder
    // drains onto continuation-only tail pages (no body content there).
    const root = cascadeRoot([fnPara("b0")]);
    const fnId = "fnTall" as BlockId;
    const embed = new Map<BlockId, ElementBox>([[fnId, cascadeBody(fnBody("fnTall", 6))]]);
    const anchors = [anchor("b0", "fnTall")];

    const tree = build(root, embed, anchors);
    expect(tree.plan.entries.length).toBeGreaterThan(1); // drained across pages

    // The LAST page is a continuation-only tail: no body blocks, an inbound
    // continuation, and a slot of separator + the continued body.
    const last = tree.plan.entries.length - 1;
    const eLast = tree.plan.entries[last];
    expect(eLast.children.length).toBe(0); // no body content
    expect(eLast.footnoteContinuation.some((c) => c.contentBlockId === fnId)).toBe(true);
    expect(eLast.footnoteContentBlockIds.length).toBe(0); // no FRESH bodies start here

    const pageLast = tree.getPage(last);
    const slotLast = pageLast.footnoteSlot;
    expect(slotLast).not.toBeNull();
    if (slotLast === null) throw new Error("unreachable");
    expect(slotLast.children[0].blockSize).toBe(FOOTNOTE_SEPARATOR_HEIGHT); // separator present
    expect(slotLast.children.length).toBe(2); // separator + ONE continued body, no fresh

    // No-loss across the whole chain: all 6 lines rendered exactly once.
    let totalFnLines = 0;
    for (let i = 0; i < tree.plan.entries.length; i++) {
      const slot = tree.getPage(i).footnoteSlot;
      if (slot === null) continue;
      for (let ci = 1; ci < slot.children.length; ci++) {
        totalFnLines += countLines(slot.children[ci]);
      }
    }
    expect(totalFnLines).toBe(6);
  });

  it("(E6(b) re-materialize) editing the split body (new ref) re-materializes BOTH the page-N slot AND the page-N+1 continuation", () => {
    const root = cascadeRoot([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const fnId = "fnEdit" as BlockId;
    const anchors = [anchor("b0", "fnEdit")];

    const bodyA = cascadeBody(fnBody("fnEdit", 5));
    const embedA = new Map<BlockId, ElementBox>([[fnId, bodyA]]);
    const treeA = build(root, embedA, anchors);

    // The split page (N) and the continuation page (N+1).
    const contIdxA = treeA.plan.entries.findIndex((e) =>
      e.footnoteContinuation.some((c) => c.contentBlockId === fnId),
    );
    expect(contIdxA).toBeGreaterThan(0);
    const pageA0 = treeA.getPage(0);
    const pageAcont = treeA.getPage(contIdxA);
    expect(pageA0.footnoteSlot).not.toBeNull();
    expect(pageAcont.footnoteSlot).not.toBeNull();

    // Tree B: a freshly-cascaded body (different ref) for the SAME id. The split
    // page's fresh-body ref changes AND the continuation page's inbound body ref
    // changes ⇒ both fingerprints differ ⇒ neither page is reused by reference.
    const bodyB = cascadeBody(fnBody("fnEdit", 5));
    expect(bodyB).not.toBe(bodyA);
    const embedB = new Map<BlockId, ElementBox>([[fnId, bodyB]]);
    const treeB = build(root, embedB, anchors, treeA);

    const contIdxB = treeB.plan.entries.findIndex((e) =>
      e.footnoteContinuation.some((c) => c.contentBlockId === fnId),
    );
    const pageB0 = treeB.getPage(0);
    const pageBcont = treeB.getPage(contIdxB);

    // Page N (fresh-body ref changed) NOT reused.
    expect(pageB0).not.toBe(pageA0);
    // Page N+1 (inbound continuation body ref changed) NOT reused — the E6(b)
    // continuation dimension is what catches this.
    expect(pageBcont).not.toBe(pageAcont);
    // And the continuation still renders the split remainder.
    expect(pageBcont.footnoteSlot).not.toBeNull();
  });
});

describe("FN-5.5 — FN-4 parity: a fully-fitting footnote renders unchanged", () => {
  it("a 1-line footnote (no split, empty continuation) renders separator + full body; slot geometry matches FN-4.3", () => {
    // The SAME case as virtual-layout-tree.footnote-slot.test.ts (a): 4 paras, a
    // 1-line footnote on b0 ⇒ slot 29, body area 35 ⇒ 2 paras on page 0.
    const root = cascadeRoot([fnPara("b0"), fnPara("b1"), fnPara("b2"), fnPara("b3")]);
    const fnId = "fnFit" as BlockId;
    const embed = new Map<BlockId, ElementBox>([[fnId, cascadeBody(fnBody("fnFit", 1))]]);
    const anchors = [anchor("b0", "fnFit")];

    const tree = build(root, embed, anchors);
    const e0 = tree.plan.entries[0];
    expect(e0.footnoteContinuation.length).toBe(0); // fully fit — no continuation
    expect(e0.footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29

    const slot = tree.getPage(0).footnoteSlot;
    expect(slot).not.toBeNull();
    if (slot === null) throw new Error("unreachable");
    expect(slot.blockOffset).toBe(PAGE.pageBlockSize - (16 + FOOTNOTE_SEPARATOR_HEIGHT)); // 35
    expect(slot.blockSize).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT); // 29
    expect(slot.children.length).toBe(2); // separator + full 1-line body
    expect(slot.children[0].blockOffset).toBe(0);
    expect(slot.children[0].blockSize).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    expect(slot.children[1].blockOffset).toBe(FOOTNOTE_SEPARATOR_HEIGHT);
    expect(slot.children[1].blockSize).toBe(16); // one line, full body

    // No continuation page exists for this footnote.
    const anyCont = tree.plan.entries.some((e) =>
      e.footnoteContinuation.some((c) => c.contentBlockId === fnId),
    );
    expect(anyCont).toBe(false);
  });
});
