/**
 * P3.3 — vertical box GEOMETRY end-to-end through the REAL layout pipeline
 * (render → cascade → paginateRoot / virtual getPage) plus the committed P3.1
 * `physicalizeVertical` block-axis-mirror pass.
 *
 * These tests exercise a multi-LINE paragraph in each writing mode and assert
 * the PHYSICAL geometry (x/y/width/height) of the line boxes — not structure or
 * counts. In the vertical modes the IFC stacks lines along the LOGICAL block
 * axis (which maps to physical X) and runs each line's inline content along the
 * LOGICAL inline axis (which maps to physical Y). After `physicalizeVertical`:
 *
 *   - `vertical-rl`: lines stack RIGHT → LEFT. Each line's physical x is the
 *     block-axis mirror against its container (the paragraph block) block-size:
 *     `x = paragraphBlockSize − line.blockOffset − line.blockSize`. The FIRST
 *     line (smallest blockOffset) lands at the LARGEST x (rightmost); each
 *     subsequent line at a SMALLER x.
 *   - `vertical-lr`: lines stack LEFT → RIGHT. No mirror: `x = line.blockOffset`.
 *     The FIRST line lands at the SMALLEST x; each subsequent line at a LARGER x.
 *   - `horizontal-tb` (control): lines stack TOP → BOTTOM (`y = line.blockOffset`)
 *     with inline content along X — byte-identical to the pre-P3 behavior.
 *
 * The writingMode reaches layout via the block-attr → component-set → cascade
 * threading wired in P3.3 (`document` / `paragraph` components forward a
 * `writingMode` attr onto the ElementBox `style`; see `leaf-style-attrs.ts`).
 */
import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { WritingMode } from "@taleweaver/core";
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { paginateRoot } from "./paginate";
import { buildBlockFitMetas } from "./build-fit-metas";
import { measurePass } from "./measure-pass";
import { IMPLICIT_SECTION_PLAN } from "./section-plan";
import { makeVirtualLayoutTree } from "./virtual-layout-tree";
import type { PageConfig } from "./page-config";
import type { ElementBox } from "@taleweaver/core";
import type { BlockBox, LineBox, PageBox } from "./layout-box";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

// Each grapheme is 8px wide, line cross-size 16px.
const CHAR_W = 8;
const LINE_CROSS = 16;

// A small page so the three short words wrap onto three separate lines.
// "aa"/"bb"/"cc" are 16px each; a content inline-size of 20px forces a wrap
// after each word (16px word + an 8px space would overflow 20px).
const pageConfig: PageConfig = {
  pageInlineSize: 20,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/**
 * Build a single-paragraph document carrying a `writingMode` attr on BOTH the
 * document root (so the page frame + cascade inherit it) and the paragraph
 * (belt-and-braces; inheritance alone would suffice). The paragraph text wraps
 * into three lines under the narrow page.
 */
function buildVerticalDoc(wm: WritingMode): ReturnType<typeof buildState> {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        attrs: { writingMode: wm },
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text("aa bb cc")]),
      }),
    ],
  });
}

/** Render + cascade the doc into a layout-ready ElementBox root. */
function cascadedRoot(wm: WritingMode): ElementBox {
  const state = buildVerticalDoc(wm);
  const renderOutput = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadePass(renderOutput.root);
  if (cascaded.type !== "element") throw new Error("expected element root");
  return cascaded;
}

/** Non-virtual paginate path → the single page. */
function paginatePage(root: ElementBox): PageBox {
  const ctx = makeRootContext(
    root.computedStyle ?? INITIAL_COMPUTED_STYLE,
    pageConfig.pageInlineSize,
  );
  const result = paginateRoot(root, ctx, createMockShaper(CHAR_W, LINE_CROSS), undefined, pageConfig);
  const page = nth(result.children, 0, "page");
  if (page.type !== "page") throw new Error("expected page");
  return page;
}

/** Virtual getPage(0) path → the single page. */
function virtualPage(root: ElementBox): PageBox {
  const contentInline =
    pageConfig.pageInlineSize -
    pageConfig.pageMargins.inlineStart -
    pageConfig.pageMargins.inlineEnd;
  const shaper = createMockShaper(CHAR_W, LINE_CROSS);
  const metas = buildBlockFitMetas(root, shaper, undefined, contentInline);
  const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
  const ctx = makeRootContext(
    root.computedStyle ?? INITIAL_COMPUTED_STYLE,
    pageConfig.pageInlineSize,
  );
  const tree = makeVirtualLayoutTree(plan, root, ctx, shaper, pageConfig);
  return tree.getPage(0);
}

/** The BFC body block child of the page. */
function bodyOf(page: PageBox): BlockBox {
  const child = nth(page.children, 0, "body child");
  if (child.type !== "block") throw new Error("expected a block body child");
  return child;
}

/** The paragraph BlockBox (the first block child of the body BFC). */
function paragraphOf(page: PageBox): BlockBox {
  const body = bodyOf(page);
  const para = body.children.find((c): c is BlockBox => c.type === "block");
  if (para === undefined) throw new Error("expected a paragraph block");
  return para;
}

/** The line boxes of a paragraph, in document (logical block) order. */
function linesOf(para: BlockBox): LineBox[] {
  return para.children.filter((c): c is LineBox => c.type === "line");
}

describe("P3.3 vertical-geometry — vertical-rl multi-line paragraph", () => {
  for (const [label, getPage] of [
    ["non-virtual paginateRoot", paginatePage] as const,
    ["virtual getPage", virtualPage] as const,
  ]) {
    describe(label, () => {
      const page = getPage(cascadedRoot("vertical-rl"));
      const para = paragraphOf(page);
      const lines = linesOf(para);

      it("wraps into (at least) three lines", () => {
        expect(lines.length).toBeGreaterThanOrEqual(3);
      });

      it("stacks line boxes RIGHT → LEFT along physical X (mirror visible)", () => {
        // First line at the LARGEST x (rightmost), each subsequent line smaller.
        for (let i = 1; i < lines.length; i++) {
          expect(nth(lines, i, "line").x).toBeLessThan(nth(lines, i - 1, "line").x);
        }
      });

      it("each line's physical x is the block-axis mirror against the paragraph block-size", () => {
        const pBlock = para.blockSize;
        for (const line of lines) {
          // The discriminating assertion: the EXACT v-rl mirror. An un-mirrored
          // layout (x = blockOffset) would FAIL this for every line whose
          // blockOffset is not the block-axis fixed point.
          expect(line.x).toBe(pBlock - line.blockOffset - line.blockSize);
        }
        // And the mirrored x-sequence genuinely differs from the un-mirrored
        // (x = blockOffset) sequence — proving the mirror ran, not an accidental
        // identity pass. (The center line of a symmetric stack is the mirror's
        // fixed point and coincides, so we compare the SEQUENCES, not each line.)
        const mirrored = lines.map((l) => l.x);
        const unMirrored = lines.map((l) => l.blockOffset);
        expect(mirrored).not.toEqual(unMirrored);
        // Concretely, the FIRST line (blockOffset 0) sits at the far/right end:
        // x = pBlock − 0 − blockSize > 0, never the un-mirrored 0.
        expect(nth(lines, 0, "line").x).toBe(pBlock - nth(lines, 0, "line").blockSize);
        expect(nth(lines, 0, "line").x).toBeGreaterThan(0);
      });

      it("runs each line's inline extent along physical Y (height spans inline content)", () => {
        for (const line of lines) {
          // Vertical: physical height = logical inlineSize (the in-line extent).
          expect(line.height).toBe(line.inlineSize);
          // The wrapped word "aa"/"bb"/"cc" is 2 chars × 8px = 16px of inline run.
          expect(line.inlineSize).toBeGreaterThanOrEqual(2 * CHAR_W);
          // Vertical: physical width = logical blockSize (the line cross size).
          expect(line.width).toBe(line.blockSize);
          // LTR inline axis ⇒ y = inlineOffset = 0 (lines start at the inline edge).
          expect(line.y).toBe(line.inlineOffset);
        }
      });
    });
  }
});

describe("P3.3 vertical-geometry — vertical-lr multi-line paragraph", () => {
  for (const [label, getPage] of [
    ["non-virtual paginateRoot", paginatePage] as const,
    ["virtual getPage", virtualPage] as const,
  ]) {
    describe(label, () => {
      const page = getPage(cascadedRoot("vertical-lr"));
      const para = paragraphOf(page);
      const lines = linesOf(para);

      it("wraps into (at least) three lines", () => {
        expect(lines.length).toBeGreaterThanOrEqual(3);
      });

      it("stacks line boxes LEFT → RIGHT along physical X (NO mirror)", () => {
        // First line at the SMALLEST x, each subsequent line larger.
        for (let i = 1; i < lines.length; i++) {
          expect(nth(lines, i, "line").x).toBeGreaterThan(nth(lines, i - 1, "line").x);
        }
      });

      it("each line's physical x is the un-mirrored block offset (x = blockOffset)", () => {
        for (const line of lines) {
          expect(line.x).toBe(line.blockOffset);
        }
      });

      it("runs each line's inline extent along physical Y", () => {
        for (const line of lines) {
          expect(line.height).toBe(line.inlineSize);
          expect(line.inlineSize).toBeGreaterThanOrEqual(2 * CHAR_W);
          expect(line.width).toBe(line.blockSize);
          expect(line.y).toBe(line.inlineOffset);
        }
      });
    });
  }
});

describe("P3.3 vertical-geometry — horizontal-tb control (lines stack along Y, inline along X)", () => {
  for (const [label, getPage] of [
    ["non-virtual paginateRoot", paginatePage] as const,
    ["virtual getPage", virtualPage] as const,
  ]) {
    describe(label, () => {
      const page = getPage(cascadedRoot("horizontal-tb"));
      const para = paragraphOf(page);
      const lines = linesOf(para);

      it("wraps into (at least) three lines", () => {
        expect(lines.length).toBeGreaterThanOrEqual(3);
      });

      it("stacks line boxes TOP → BOTTOM along physical Y", () => {
        for (let i = 1; i < lines.length; i++) {
          expect(nth(lines, i, "line").y).toBeGreaterThan(nth(lines, i - 1, "line").y);
        }
      });

      it("identity mapping: x = inlineOffset, y = blockOffset, no mirror", () => {
        for (const line of lines) {
          expect(line.x).toBe(line.inlineOffset);
          expect(line.y).toBe(line.blockOffset);
          // Inline extent runs along X (width = inlineSize), lines cross Y.
          expect(line.width).toBe(line.inlineSize);
          expect(line.height).toBe(line.blockSize);
        }
      });
    });
  }
});
