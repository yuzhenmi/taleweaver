// packages/core/src/cursor/hit-test-footnote.test.ts
//
// FN-7.2: clicking into the footnote-slot band must resolve to a Position INSIDE
// the footnote body, NOT the nearest main-body line.
//
// The footnote slot sits at page-local [contentBottom − footnoteSlotHeight,
// contentBottom) — INSIDE the body content band (the slot SHRINKS the available
// body space but does NOT change `effectiveBottomInset`). So footnote-slot lines
// fall into NEITHER the header band (above `contentTop`) NOR the footer band
// (at/below `contentBottom`): `pickRegionByBand`'s two-bucket logic silently
// DROPS them, and a click in the footnote area falls through to the body lines.
// FN-7.2 adds a THIRD bucket: a click in [slotTop, contentBottom) where slotTop =
// PageBox.footnoteSlot.blockOffset routes to the footnote-slot lines.
//
// These tests build the fixture through the REAL footnote producer (render →
// cascade root + cascade embed bodies → collectFootnoteAnchors →
// buildVirtualPaginatedTree → assembled positioned tree), mirroring the FN-4.3
// virtual-layout-tree.footnote-slot fixtures but driven from a real `State` so
// `resolveBlock` / `selectionContextOf` line up with the line `ownerBlockId`s.

import { describe, it, expect, beforeEach } from "vitest";
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { getLineIndex, collectLineLeaves } from "./line-flatten";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import { positionTreeForTest } from "../test-utils/position-tree";
import {
  __resetGetPageDriverCountForTest,
} from "../layout/virtual-layout-tree";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "@taleweaver/core";
import {
  resolveBlock,
  selectionContextOf,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
} from "@taleweaver/core";
import { collectFootnoteAnchors } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

// Footnote body root + its single paragraph child. The body is a CONTAINER (per
// `footnote-body` component): its paragraph CHILD carries the line, and
// `selectionContextOf` of that child walks up to the body root (an embedContent,
// NOT state.rootId).
const FN_BODY = "fn-body" as BlockId;
const FN_BODY_P = "fn-body-p" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_P1 = "ftr-p1" as BlockId;

// A TALL page so a SHORT body (2 short paragraphs) leaves a big GAP between the
// body content and the footnote slot, which is laid into the BOTTOM of the body
// content area (above the footer band).
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 400,
    pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/** A footnote-anchor EmbedItem pointing at the footnote body root. */
function fnAnchor() {
  return embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: FN_BODY });
}

interface Built {
  state: State;
  positioned: LayoutBox;
  shaper: TextShaper;
}

/**
 * Build a SINGLE-PAGE doc with a SHORT 2-paragraph body, a footnote anchor on
 * the LAST body paragraph, the footnote body in embedContents, and optionally a
 * footer template body. Lay out through the real footnote producer and return a
 * positioned snapshot.
 */
function buildDoc(opts: { footnoteText: string; footerPara?: string }): Built {
  const templateBlocks = [];
  if (opts.footerPara !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: FOOTER_ROOT,
        type: "template-body",
        firstChildId: FOOTER_P1,
        lastChildId: FOOTER_P1,
      }),
      buildBlock({
        id: FOOTER_P1,
        type: "paragraph",
        parentId: FOOTER_ROOT,
        inlineContent: inlineContent([text(opts.footerPara)]),
      }),
    );
  }

  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        // A doc-root footer (#C.2c I1): `buildSectionPlan` reads
        // `footerBlockId` off the cascaded root metadata so the implicit
        // section's pages carry the footer slot.
        attrs:
          opts.footerPara !== undefined
            ? { footerBlockId: FOOTER_ROOT }
            : undefined,
        firstChildId: "bp0",
        lastChildId: "bp1",
      }),
      buildBlock({
        id: "bp0",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "bp1",
        inlineContent: inlineContent([text("body one")]),
      }),
      buildBlock({
        id: "bp1",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "bp0",
        // The footnote anchor lives at the END of the last body paragraph.
        inlineContent: inlineContent([text("body two"), fnAnchor()]),
      }),
    ],
    embedContents: [
      buildBlock({
        id: FN_BODY,
        type: "footnote-body",
        parentId: null,
        firstChildId: FN_BODY_P,
        lastChildId: FN_BODY_P,
      }),
      buildBlock({
        id: FN_BODY_P,
        type: "paragraph",
        parentId: FN_BODY,
        inlineContent: inlineContent([text(opts.footnoteText)]),
      }),
    ],
    templateContents: templateBlocks,
  });

  const out = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  );
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.embedContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedEmbedContents.set(id, c);
  }
  const cascadedTemplateContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.templateContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedTemplateContents.set(id, c);
  }

  const footnoteAnchors = collectFootnoteAnchors(state);
  expect(footnoteAnchors.map((a) => a.contentBlockId)).toEqual([FN_BODY]);

  const cfg = pageConfig();
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = buildVirtualPaginatedTree(
    cascadedRoot,
    ctx,
    shaper,
    cfg,
    undefined,
    cascadedTemplateContents,
    cascadedEmbedContents,
    footnoteAnchors,
  );
  const positioned = positionTreeForTest(virtual);
  return { state, positioned, shaper };
}

/**
 * Read page 0's content-area edges (#332) and the footnote slot's page-local top.
 * `positioned` is the assembled BlockBox whose children are PageBoxes.
 */
function page0Geometry(positioned: LayoutBox): {
  contentTop: number;
  contentBottom: number;
  blockSize: number;
  slotTop: number;
  slotBottom: number;
} {
  const children = positioned.type === "block" ? positioned.children : [];
  for (const c of children) {
    if (c.type === "page" && c.pageIndex === 0) {
      const slot = c.footnoteSlot;
      if (slot === null) throw new Error("page0Geometry: page 0 has no footnoteSlot");
      return {
        contentTop: c.effectiveTopInset,
        contentBottom: c.blockSize - c.effectiveBottomInset,
        blockSize: c.blockSize,
        slotTop: slot.blockOffset,
        slotBottom: slot.blockOffset + slot.blockSize,
      };
    }
  }
  throw new Error("page0Geometry: page 0 not found");
}

/** Body / footnote / footer line partitions on page 0, keyed by context. */
function lineGeometry(state: State, positioned: LayoutBox) {
  const all = getLineIndex(positioned).all;
  const bodyLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === state.rootId,
  );
  const footnoteLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === FN_BODY,
  );
  const footerLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === FOOTER_ROOT,
  );
  const bodyMaxBottom = Math.max(
    ...bodyLines.map((l) => l.absoluteY + l.line.blockSize),
  );
  return { all, bodyLines, footnoteLines, footerLines, bodyMaxBottom };
}

beforeEach(() => {
  __resetGetPageDriverCountForTest();
});

describe("FN-7.2 — click into the footnote-slot band resolves to the footnote body", () => {
  it("precondition: the footnote slot sits below the body content with a gap, inside the content band", () => {
    const { state, positioned } = buildDoc({ footnoteText: "the footnote" });
    const g = lineGeometry(state, positioned);
    const edges = page0Geometry(positioned);
    // 2 body lines + at least 1 footnote line.
    expect(g.bodyLines.length).toBe(2);
    expect(g.footnoteLines.length).toBeGreaterThanOrEqual(1);
    // The slot is INSIDE the body content band (its top is below contentTop and
    // its bottom is at/before contentBottom — it shrinks the body, not the
    // bottom inset).
    expect(edges.slotTop).toBeGreaterThan(edges.contentTop);
    expect(edges.slotBottom).toBeLessThanOrEqual(edges.contentBottom + 0.5);
    // There is a visible GAP between the body content and the slot.
    expect(edges.slotTop).toBeGreaterThan(g.bodyMaxBottom + 1);
  });

  it("CASE 1 (THE BUG): a click in the footnote-slot band → INSIDE the footnote body (NOT the nearest body line)", () => {
    const fnText = "the footnote";
    const { state, positioned, shaper } = buildDoc({ footnoteText: fnText });
    const g = lineGeometry(state, positioned);
    const fnLine = nth(g.footnoteLines, 0, "footnote line");
    // Click squarely on the footnote line, a few chars in.
    const y = fnLine.absoluteY + fnLine.line.blockSize / 2;
    const x = fnLine.absoluteX + SHAPER_CHAR_W * 3;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    // The blockId must be the footnote body paragraph — an embedContent block.
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("embedContent");
    expect(pos.blockId).toBe(FN_BODY_P);
    // NOT a body block.
    expect(pos.blockId).not.toBe("bp1");
    // Offset lands ON the clicked character (3 chars in), not clamped to a body
    // line end.
    expect(pos.offset).toBe(3);
  });

  it("CASE 2: a click in the body ABOVE the slot still resolves to a body position", () => {
    const { state, positioned, shaper } = buildDoc({ footnoteText: "the footnote" });
    const g = lineGeometry(state, positioned);
    const first = nth(g.bodyLines, 0, "body line");
    const y = first.absoluteY + first.line.blockSize / 2;
    const x = first.absoluteX + SHAPER_CHAR_W * 1 + 1; // mid second-char
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp0");
    expect(pos.offset).toBe(1);
  });

  it("CASE 3: the body's empty TAIL (above the slot) still clamps to the END of the last body block (no footnote capture)", () => {
    // `bp1` is "body two" (8 chars) followed by the footnote-anchor marker (a
    // 1-unit inline-block), so the line's last cursor stop is offset 9 — the
    // position AFTER the marker, the true line end. A click far past the line end
    // (x=1000) clamps to that line end, landing AFTER the marker (exactly as a
    // past-end click on a text-only line lands after the last glyph). It must NOT
    // be captured by the footnote slot.
    const lastBodyText = "body two"; // the bp1 text content (before the anchor)
    const { state, positioned, shaper } = buildDoc({ footnoteText: "the footnote" });
    const g = lineGeometry(state, positioned);
    const edges = page0Geometry(positioned);
    // A y strictly between the last body line's bottom and the slot's top.
    const y = (g.bodyMaxBottom + edges.slotTop) / 2;
    expect(y).toBeGreaterThan(g.bodyMaxBottom);
    expect(y).toBeLessThan(edges.slotTop);
    const pos = resolvePositionFromPixel(state, positioned, shaper, 1000, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    // Last body block, clamped to the line END = AFTER the 1-unit marker
    // (text length + 1), not the footnote slot.
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp1");
    expect(pos.offset).toBe(lastBodyText.length + 1);
  });

  it("CASE 4: with BOTH a footnote slot and a footer, a click in the FOOTER band still resolves to the footer (no regression)", () => {
    const { state, positioned, shaper } = buildDoc({
      footnoteText: "the footnote",
      footerPara: "the footer",
    });
    const g = lineGeometry(state, positioned);
    const edges = page0Geometry(positioned);
    expect(g.footerLines.length).toBe(1);
    const footer = nth(g.footerLines, 0, "footer line");
    // Sanity: the footer band sits at/below contentBottom, BELOW the slot.
    expect(footer.absoluteY).toBeGreaterThanOrEqual(edges.contentBottom - 0.5);
    expect(footer.absoluteY).toBeGreaterThanOrEqual(edges.slotBottom - 0.5);
    const y = footer.absoluteY + footer.line.blockSize / 2;
    const x = footer.absoluteX + SHAPER_CHAR_W * 2;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(FOOTER_P1);
  });

  it("CASE 6 (the marker-after caret bug): clicking the RIGHT half of the footnote call-marker lands the caret AFTER it, not before", () => {
    // The footnote anchor (an inline-block call-marker = ONE state offset unit)
    // sits at the END of `bp1` ("body two", 8 chars). Clicking the marker's left
    // half resolves to offset 8 (the position BEFORE the embed); clicking its
    // right half must resolve to offset 9 (AFTER the embed). The pre-fix hit-test
    // hardcoded the inline-block to its LEADING edge, so a click anywhere on the
    // marker — including just past it — resolved to 8, making the caret
    // impossible to place after a footnote marker by clicking.
    const bp1Text = "body two";
    const { state, positioned, shaper } = buildDoc({ footnoteText: "the footnote" });

    // Locate the marker leaf on bp1's line.
    const bp1Lines = getLineIndex(positioned).byBlock.get("bp1" as BlockId) ?? [];
    expect(bp1Lines.length).toBe(1);
    const line = nth(bp1Lines, 0, "bp1 line");
    const leaves = collectLineLeaves(line.line, line.absoluteX, line.absoluteY);
    const marker = leaves.find((l) => l.kind === "inline-block");
    expect(marker).toBeDefined();
    if (marker === undefined) return;
    // The marker owns exactly one offset unit (state-model embed == 1 unit).
    expect(marker.offsetContribution).toBe(1);

    const y = line.absoluteY + line.line.blockSize / 2;

    // RIGHT half → AFTER the marker (offset = text length + 1).
    const right = resolvePositionFromPixel(
      state,
      positioned,
      shaper,
      marker.absoluteX + marker.width * 0.9,
      y,
      0,
    );
    expect(right).not.toBeNull();
    if (right === null) return;
    expect(right.blockId).toBe("bp1");
    expect(right.offset).toBe(bp1Text.length + 1);

    // LEFT half → BEFORE the marker (offset = text length).
    const left = resolvePositionFromPixel(
      state,
      positioned,
      shaper,
      marker.absoluteX + marker.width * 0.1,
      y,
      0,
    );
    expect(left).not.toBeNull();
    if (left === null) return;
    expect(left.blockId).toBe("bp1");
    expect(left.offset).toBe(bp1Text.length);
  });

  it("CASE 5: with BOTH a slot and a footer, a click in the FOOTNOTE band still resolves to the footnote (footnote wins over body, footer untouched)", () => {
    const { state, positioned, shaper } = buildDoc({
      footnoteText: "the footnote",
      footerPara: "the footer",
    });
    const g = lineGeometry(state, positioned);
    const fnLine = nth(g.footnoteLines, 0, "footnote line");
    const y = fnLine.absoluteY + fnLine.line.blockSize / 2;
    const x = fnLine.absoluteX + SHAPER_CHAR_W * 1;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("embedContent");
    expect(pos.blockId).toBe(FN_BODY_P);
  });
});
