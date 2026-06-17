// packages/core/src/layout/__tests__/growth-cap.test.ts
//
// Task #329 — header/footer growth CAP. The #328 growing slot has NO upper
// bound: a header/footer taller than the page makes the body content area ≤ 0
// and the pipeline THROWS. This caps the slot growth AT THE SOURCE
// (`computeSlotInsets`) so the body keeps a MINIMUM content height
// (`minBodyPx` = one body-root line-height), making the throw unreachable.
//
// Cap rule (per section boundary, against THAT boundary's effCfg.pageBlockSize):
//   minBody     = max(0, min(minBodyPx, pageBlockSize − marginTop − marginBottom))
//   maxInsetSum = pageBlockSize − minBody
//   top = max(marginTop, headerHeight); bottom = max(marginBottom, footerHeight)
//   if top + bottom > maxInsetSum:
//     growthTop = top − marginTop; growthBottom = bottom − marginBottom
//     growth = growthTop + growthBottom; budget = max(0, maxInsetSum − marginTop − marginBottom)
//     if growth > 0:  top = marginTop + growthTop*budget/growth
//                     bottom = marginBottom + growthBottom*budget/growth
//
// Over-tall slot content visually OVERLAPS the body (accepted v1; clean clip is
// a separate future feature). `layoutSlot` keeps availableBlockSize MAX_SAFE_INTEGER.
//
// Test geometry numbers (mock shaper charWidth 8, lineHeight 16 ⇒ minBodyPx = 16):
//   pageBlockSize 300, margins 10/10 ⇒ minBody = min(16, 280) = 16; maxInsetSum = 284.

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

// ---------------------------------------------------------------------------
// Fixture builders (mirror growing-slot.test.ts).
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

function fixedBlock(key: string, blockSize: number): ElementBox {
  return createElementBox(key, { display: "block", blockSize } as Style, []);
}

/** A paragraph with `numLines` hard-wrapped lines (mock line-height 16). */
function paragraph(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "block", whiteSpace: "pre" } as Style, [textNode]);
}

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
// minBodyPx for INITIAL_COMPUTED_STYLE under the mock shaper = lineHeight 16.
const MIN_BODY_PX = 16;

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
// (1) NO CRASH (load-bearing): a header taller than the page does NOT throw;
//     the body keeps minBody; the page count is finite.
// ---------------------------------------------------------------------------

describe("growth-cap — (1) NO CRASH: header taller than the page", () => {
  it("a header taller than pageBlockSize does not throw; body keeps minBody; finite pages", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    // Header body 20 lines = 320px > pageBlockSize 300.
    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("h0", 20)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const cfg = pageConfig(300, 10);

    let tree: ReturnType<typeof build> | undefined;
    expect(() => {
      tree = build(root, cfg, bodies);
      tree.getPage(0);
    }).not.toThrow();
    if (tree === undefined) throw new Error("tree not built");

    // Body keeps exactly one root line-height: effContentBlockSize === minBody.
    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    const effContent =
      entry0.pageConfig.pageBlockSize - entry0.effectiveTopInset - entry0.effectiveBottomInset;
    expect(effContent).toBe(MIN_BODY_PX);
    // Finite page count.
    expect(Number.isFinite(tree.plan.entries.length)).toBe(true);
    expect(tree.plan.entries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Cap math — lone tall header. The whole growth budget goes to the header.
// ---------------------------------------------------------------------------

describe("growth-cap — (2) lone tall header gets the whole growth budget", () => {
  it("effectiveTopInset = pageBlockSize − minBody − marginBottom; bottom stays at marginBottom", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    // Header H = 320 (20 lines): marginTop + H + marginBottom = 340 > 284 (maxInsetSum).
    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("h0", 20)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    // top = 300 − 16 − 10 = 274; bottom = 10 (marginBottom).
    expect(entry0.effectiveTopInset).toBe(300 - MIN_BODY_PX - 10);
    expect(entry0.effectiveBottomInset).toBe(10);
    // Body origin reflects the capped top inset.
    const body0 = tree.getPage(0).children[0];
    if (body0 === undefined) throw new Error("no body box");
    expect(body0.blockOffset).toBe(274);
  });
});

// ---------------------------------------------------------------------------
// (3) Cap math — both tall ⇒ proportional split summing to maxInsetSum.
// ---------------------------------------------------------------------------

describe("growth-cap — (3) both tall ⇒ proportional split", () => {
  it("effectiveTopInset + effectiveBottomInset === maxInsetSum; each ≥ its margin", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const ftrId = "ftr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, {
      headerBlockId: hdrId,
      footerBlockId: ftrId,
    });
    // Equal tall header + footer (both 320): symmetric split.
    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("h0", 20)]);
    const ftrBody = cascadeRoot({ display: "block" }, [paragraph("f0", 20)]);
    const bodies = new Map<BlockId, ElementBox>([
      [hdrId, hdrBody],
      [ftrId, ftrBody],
    ]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    const maxInsetSum = 300 - MIN_BODY_PX; // 284
    expect(entry0.effectiveTopInset + entry0.effectiveBottomInset).toBe(maxInsetSum);
    // Symmetric: each = 10 + 310*264/620 = 142.
    expect(entry0.effectiveTopInset).toBe(142);
    expect(entry0.effectiveBottomInset).toBe(142);
    // Each ≥ its margin (10).
    expect(entry0.effectiveTopInset).toBeGreaterThanOrEqual(10);
    expect(entry0.effectiveBottomInset).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// (4) NO-REGRESSION (load-bearing): a slot that FITS is unchanged vs #328.
// ---------------------------------------------------------------------------

describe("growth-cap — (4) NO-REGRESSION: a fitting slot is uncapped", () => {
  it("a header whose top+bottom ≤ maxInsetSum has insets UNCHANGED vs #328 (no cap)", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const hdrId = "hdr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: hdrId });
    // Header 30px: top = max(10, 30) = 30; bottom = 10; sum 40 ≤ 284. No cap.
    const hdrBody = cascadeRoot({ display: "block" }, [fixedBlock("h0", 30)]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    // Uncapped #328 values: top = 30, bottom = 10.
    expect(entry0.effectiveTopInset).toBe(30);
    expect(entry0.effectiveBottomInset).toBe(10);
  });

  it("a no-slot doc is byte-identical (insets default to raw margins, no map entry)", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg);

    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    expect(entry0.effectiveTopInset).toBe(10);
    expect(entry0.effectiveBottomInset).toBe(10);
    expect(tree.plan.entries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (5) Degenerate doc-wide margins (margins alone ≥ pageBlockSize, NO slot):
//     the doc-wide coarse guard STILL throws (kept, cap doesn't touch it).
// ---------------------------------------------------------------------------

describe("growth-cap — (5) degenerate doc-wide margins still throw (no slot)", () => {
  it("raw margins alone ≥ pageBlockSize ⇒ measurePass coarse guard throws", () => {
    const children = Array.from({ length: 2 }, (_, i) => fixedBlock(`b${i}`, 50));
    const root = cascadeRoot({ display: "block" }, children);
    // pageBlockSize 100, margins 60/60 ⇒ content −20 ≤ 0 ⇒ coarse guard throws.
    const cfg = pageConfig(100, 60);
    expect(() => build(root, cfg)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// (6) Footer symmetric: a lone tall footer gets the whole budget.
// ---------------------------------------------------------------------------

describe("growth-cap — (6) lone tall footer gets the whole growth budget", () => {
  it("effectiveBottomInset = pageBlockSize − minBody − marginTop; top stays at marginTop", () => {
    const children = Array.from({ length: 4 }, (_, i) => fixedBlock(`b${i}`, 100));
    const ftrId = "ftr-root" as BlockId;
    const root = cascadeRoot({ display: "block" }, children, { footerBlockId: ftrId });
    const ftrBody = cascadeRoot({ display: "block" }, [paragraph("f0", 20)]); // 320 > page
    const bodies = new Map<BlockId, ElementBox>([[ftrId, ftrBody]]);
    const cfg = pageConfig(300, 10);
    const tree = build(root, cfg, bodies);

    const entry0 = tree.plan.entries[0];
    if (entry0 === undefined) throw new Error("no entry 0");
    expect(entry0.effectiveTopInset).toBe(10); // marginTop
    expect(entry0.effectiveBottomInset).toBe(300 - MIN_BODY_PX - 10); // 274
    // Body content area = minBody.
    const effContent =
      entry0.pageConfig.pageBlockSize - entry0.effectiveTopInset - entry0.effectiveBottomInset;
    expect(effContent).toBe(MIN_BODY_PX);
    // Footer slot origin = pageBlockSize − effectiveBottomInset = 300 − 274 = 26.
    const ftr = tree.getPage(0).footerSlot;
    if (ftr === null) throw new Error("footer slot null");
    expect(ftr.blockOffset).toBe(300 - 274);
    // Footer lays at NATURAL height (uncapped) — slot availableBlockSize unchanged.
    expect(ftr.blockSize).toBe(320);
  });
});
