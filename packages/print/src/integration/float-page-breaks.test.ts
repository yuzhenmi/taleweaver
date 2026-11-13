// P3 M3 — page-break rules for paragraph-anchored floats (wrapped inline
// images), through both production pagination paths: the virtualized tree
// (per-page float envs) and the legacy `paginateRoot` (one env for the doc).
// Each case asserts the geometry AND that both paths give identical pages.
//
// Mock shaper: 8px per char, 16px lines; content 500 wide; a paragraph ends
// with an 8px margin. WORDS wraps to 2 lines at full width (59 + 47 chars), and
// still 2 lines beside a 100-wide float (≤ 50 chars per line).

import { describe, it, expect } from "vitest";
import { render, buildDocument, buildBlock, inlineContent, text, embed, asBlockId, INLINE_IMAGE_EMBED_TYPE } from "@taleweaver/core";
import { createDefaultComponentRegistry, createDefaultAttrRegistry, cascadePass, createMockShaper } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { BlockId, ElementBox, InlineItem, RenderNode, TextShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { paginateRoot } from "../layout/paginate";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import type { PageConfig } from "../layout/page-config";
import type { PageBox } from "../layout/page-box";
import type { LayoutBox } from "../layout/layout-box";

const shaper = createMockShaper(8, 16);

/** 8px per char; a run's line height is its font size (so a paragraph's runs can be shorter than its strut). */
function sizedShaper(): TextShaper {
  const base = createMockShaper(8, 16);
  const metrics = (h: number) => ({ ascent: h * 0.8, descent: h * 0.2, lineGap: 0, capHeight: h * 0.7, xHeight: h * 0.5 });
  return {
    shape: (text, style, dir) => ({ ...base.shape(text, style, dir), ...metrics(style.fontSize) }),
    measureFontMetrics: (style) => metrics(style.fontSize),
  };
}
const WORDS = "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";

function page(blockSize: number): PageConfig {
  return { pageInlineSize: 500, pageBlockSize: blockSize, pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }, pageGap: 20 };
}

function image(height: number, wrap = "left", extra: Record<string, unknown> = {}): InlineItem {
  return embed(INLINE_IMAGE_EMBED_TYPE, { src: "i.png", width: 100, height, wrap, ...extra });
}

function docRoot(paras: readonly InlineItem[][]): ElementBox {
  const cascaded = cascadePass(renderDoc(paras));
  if (cascaded.type !== "element") throw new Error("cascaded root is not an element");
  return cascaded;
}

function renderDoc(paras: readonly InlineItem[][]): RenderNode {
  const ids = paras.map((_, k) => `p${k}`);
  const document = buildDocument({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? "p0", lastChildId: ids[ids.length - 1] ?? "p0" }),
      ...paras.map((items, k) => buildBlock({
        id: `p${k}`, type: "paragraph", parentId: "doc",
        prevSiblingId: k > 0 ? `p${k - 1}` : null,
        nextSiblingId: k < paras.length - 1 ? `p${k + 1}` : null,
        inlineContent: inlineContent(items),
      })),
    ],
  });
  return render(document, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
}

/** A line: [owner paragraph, y, x, width, first offset, end offset, height] (page-relative). */
type LineGeo = readonly [string | undefined, number, number, number, number, number, number];
/** A float box: [key, y, x, width, height] (page-relative). */
type FloatGeo = readonly [string, number, number, number, number];
interface PageGeo { readonly lines: LineGeo[]; readonly floats: FloatGeo[] }

function pageGeo(p: PageBox): PageGeo {
  const out: PageGeo = { lines: [], floats: [] };
  const walk = (box: LayoutBox, ox: number, oy: number): void => {
    const x = ox + box.x;
    const y = oy + box.y;
    if (box.type === "line") {
      out.lines.push([box.ownerBlockId, y, x, box.width, box.inlineOffsetStart, box.inlineOffsetEnd, box.height]);
      return;
    }
    if (box.type === "block" && box.computedStyle.float !== "none") out.floats.push([box.key, y, x, box.width, box.height]);
    if ("children" in box) for (const c of box.children) walk(c, x, y);
  };
  for (const c of p.children) walk(c, 0, 0);
  return out;
}

/** Lay the doc out on both paths; assert they agree page for page; return the pages. */
function layBoth(paras: readonly InlineItem[][] | ElementBox, cfg: PageConfig, sh: TextShaper = shaper): PageGeo[] {
  const root = "type" in paras ? paras : docRoot(paras);
  const cs = root.computedStyle;
  if (cs === undefined) throw new Error("root is not cascaded");
  const legacy = paginateRoot(root, makeRootContext(cs, cfg.pageInlineSize), sh, undefined, cfg)
    .children.flatMap((c) => c.type === "page" ? [pageGeo(c)] : []);
  const tree = buildVirtualPaginatedTree(root, makeRootContext(cs, cfg.pageInlineSize), sh, cfg);
  // Last page first: each page must lay out on its own, whatever was laid before.
  const virtual = tree.plan.entries.map((_, i) => i).reverse().map((i) => pageGeo(tree.getPage(i))).reverse();
  expect(virtual, "virtual == legacy").toEqual(legacy);
  return virtual;
}

/** No line box crosses a float box it shares block space with. */
function expectNoOverlap(g: PageGeo | undefined): void {
  if (g === undefined) throw new Error("no such page");
  for (const [key, fy, fx, fw, fh] of g.floats) {
    for (const [owner, y, x, w, , , h] of g.lines) {
      const crosses = y < fy + fh && y + h > fy && x < fx + fw && x + w > fx;
      expect(crosses, `line of ${owner} at y=${y} crosses ${key}`).toBe(false);
    }
  }
}

/** No two float boxes share space. */
function expectFloatsDisjoint(g: PageGeo | undefined): void {
  if (g === undefined) throw new Error("no such page");
  g.floats.forEach(([ka, ya, xa, wa, ha], i) => g.floats.slice(i + 1).forEach(([kb, yb, xb, wb, hb]) => {
    expect(ya < yb + hb && yb < ya + ha && xa < xb + wb && xb < xa + wa, `${ka} overlaps ${kb}`).toBe(false);
  }));
}

/** A hand-built wrapped image (inline-block float) anchored in block `blockId`. */
function wrappedAtom(key: string, blockId: string, w: number, h: number, offsetBlock = 0): ElementBox {
  return createElementBox(key, { display: "inline-block", float: "inline-start" }, [
    createElementBox(`${key}-img`, { display: "block", inlineSize: w, blockSize: h }, []),
  ], { inlineFloat: { blockId: blockId as BlockId, offset: 0, offsetBlock, exclusion: "side" } });
}

/** A 25px-strut paragraph whose text runs are 15px tall (short lines). */
function shortLinePara(key: string, before: readonly ElementBox[], words: number): ElementBox {
  return createElementBox(key, { display: "block", fontSize: 25 }, [
    ...before,
    createElementBox(`${key}-s`, { display: "inline", fontSize: 15 }, [
      createTextBox(`${key}-t`, {}, Array.from({ length: words }, () => "abcdefghi").join(" ")),
    ]),
  ]);
}

function cascadedRoot(children: readonly ElementBox[]): ElementBox {
  const root = cascadePass(createElementBox("doc", { display: "block" }, [...children]));
  if (root.type !== "element") throw new Error("cascaded root is not an element");
  return root;
}

function linesOf(g: PageGeo | undefined, owner: string): LineGeo[] {
  if (g === undefined) throw new Error("no such page");
  return g.lines.filter((l) => l[0] === owner);
}

describe("page breaks — paragraph-anchored floats (P3 M3)", () => {
  it("R2-1: a paragraph with a float split across pages resumes at the right text; its float paints once, on page 1", () => {
    // p0: a 32-tall float at its top beside lines 0–1, then full-width lines;
    // 10 lines on 80px pages → 5 on page 1, the rest on page 2.
    const pages = layBoth([[image(32), text(`${WORDS} ${WORDS} ${WORDS} ${WORDS} ${WORDS}`)]], page(80));
    const [p1, p2] = [linesOf(pages[0], "p0"), linesOf(pages[1], "p0")];
    expect(p1.map((l) => [l[2], l[3]])).toEqual([[100, 400], [100, 400], [0, 500], [0, 500], [0, 500]]);
    // Page 2 starts exactly where page 1 stopped, full width.
    expect(p2[0]?.[4]).toBe(p1[p1.length - 1]?.[5]);
    for (const l of p2) expect([l[2], l[3]]).toEqual([0, 500]);
    expect(pages.flatMap((g) => g.floats).length).toBe(1);
    expect(pages[0]?.floats.length).toBe(1);
    expectNoOverlap(pages[0]);
  });

  it("R2-2: a paragraph pushed whole after placing its float leaves no ghost — on page 2 its float is at the column edge, its lines narrowed once", () => {
    // p0 (4 short lines + margin) leaves 8px: p1's first line does not fit, so
    // p1 — with its float — moves to page 2.
    const pages = layBoth([[text("a\nb\nc\nd")], [image(32), text(`${WORDS} ${WORDS}`)]], page(80));
    expect(pages[0]?.floats).toEqual([]);
    for (const l of linesOf(pages[0], "p0")) expect([l[2], l[3]]).toEqual([0, 500]);
    const g = pages[1];
    expect(g?.floats.map((f) => [f[1], f[2]])).toEqual([[0, 0]]);
    expect(linesOf(g, "p1").map((l) => [l[1], l[2], l[3]])).toEqual([[0, 100, 400], [16, 100, 400], [32, 0, 500], [48, 0, 500]]);
    expectNoOverlap(g);
  });

  it("R2-3: a float crossing the page end is shifted up to end at the page bottom, staying on its anchor's page", () => {
    // p0 = 2 lines + margin → p1 at 40; its 48-tall float [40,88] crosses 80 →
    // [32,80]. p1's first two lines stay on page 1 beside it.
    const pages = layBoth([[text(WORDS)], [image(48), text(`${WORDS} ${WORDS}`)]], page(80));
    expect(pages[0]?.floats.map((f) => [f[1], f[2], f[4]])).toEqual([[32, 0, 48]]);
    expect(pages[1]?.floats).toEqual([]);
    expect(linesOf(pages[0], "p1").map((l) => [l[1], l[2], l[3]])).toEqual([[40, 100, 400], [56, 100, 400]]);
    for (const l of linesOf(pages[1], "p1")) expect([l[2], l[3]]).toEqual([0, 500]);
    expectNoOverlap(pages[0]);
  });

  it("R2-3: a float taller than the space left rises above its paragraph; the content before it wraps around it", () => {
    // p1 at 40 with a 64-tall float → [16,80]: above p1's top, beside p0's second line.
    const pages = layBoth([[text(WORDS)], [image(64), text(`${WORDS} ${WORDS}`)]], page(80));
    expect(pages[0]?.floats.map((f) => [f[1], f[2], f[4]])).toEqual([[16, 0, 64]]);
    expect(linesOf(pages[0], "p0").map((l) => [l[1], l[2], l[3]])).toEqual([[0, 0, 500], [16, 100, 400]]);
    expect(linesOf(pages[0], "p1").map((l) => [l[1], l[2], l[3]])).toEqual([[40, 100, 400], [56, 100, 400]]);
    expect(pages.flatMap((g) => g.floats).length).toBe(1);
    expectNoOverlap(pages[0]);
  });

  it("R2-3: a float taller than the page overflows its anchor's page and never narrows the next page", () => {
    const pages = layBoth([[image(120), text(`${WORDS} ${WORDS} ${WORDS} ${WORDS}`)]], page(80));
    expect(pages[0]?.floats.map((f) => [f[1], f[4]])).toEqual([[0, 120]]);
    for (const l of linesOf(pages[1], "p0")) expect([l[2], l[3]]).toEqual([0, 500]);
    expectNoOverlap(pages[0]);
  });

  it("fixpoint: an image that must rise only once an earlier one re-flowed the text rises too; no line crosses either", () => {
    // Pass 1: B (right, 136) fits under p1's top [40,176]; A (left, 300×200)
    // rises to [0,200]. Pass 2: p0 beside A wraps from 2 to 5 lines, p1 moves to
    // 88, so B rises to [64,200] — beside p0's last line. Pass 3 wraps p0 around both.
    const pages = layBoth([
      [text(WORDS)],
      [image(136, "right"), text("ab")],
      [image(200, "left", { width: 300 }), text(WORDS)],
    ], page(200));
    expect(pages[0]?.floats.map((f) => [f[1], f[2], f[4]])).toEqual([[64, 400, 136], [0, 0, 200]]);
    expect(pages.flatMap((g) => g.floats).length).toBe(2);
    expectNoOverlap(pages[0]);
  });

  it("fixpoint: a paragraph its own risen image pushed off moves to the next page with it — no empty exclusion left behind", () => {
    // A (80) rises to [0,80] beside p0, which then wraps to 3 lines and leaves p1
    // one line: p1 (orphans 2) breaks to page 2, taking A.
    const pages = layBoth([[text(WORDS)], [image(80), text(`${WORDS} ${WORDS}`)]], page(80));
    expect(pages[0]?.floats).toEqual([]);
    for (const l of linesOf(pages[0], "p0")) expect([l[2], l[3]]).toEqual([0, 500]);
    expect(pages[1]?.floats.map((f) => [f[1], f[2]])).toEqual([[0, 0]]);
    expect(linesOf(pages[1], "p1")[0]?.slice(1, 4)).toEqual([0, 100, 400]);
    expectNoOverlap(pages[1]);
  });

  it("same-side images too wide to sit side by side, near the page end: the second takes the free spot above the first, on the page", () => {
    // p1's R1 lands [104,176]; p2's R2 (60) would be pushed below it to
    // [176,236], past the end (232) → the lowest free spot that still ends on
    // the page: [44,104], starting inside p0's line [32,48), which wraps beside it.
    const pages = layBoth([
      [text("a\nb\nc\nd\ne\nf")],
      [image(72, "right", { width: 300 }), text("ab")],
      [image(60, "right", { width: 300 }), text("cd")],
    ], page(232));
    expect(pages[0]?.floats.map((f) => [f[1], f[4]])).toEqual([[104, 72], [44, 60]]);
    expect(linesOf(pages[0], "p0").map((l) => [l[1], l[3]])).toEqual([[0, 500], [16, 500], [32, 200], [48, 200], [64, 200], [80, 200]]);
    expectNoOverlap(pages[0]);
  });

  it("a negative offsetBlock does not lift an image above the page top", () => {
    const pages = layBoth([[image(32, "left", { offsetBlock: -50 }), text(WORDS)]], page(80));
    expect(pages[0]?.floats.map((f) => f[1])).toEqual([0]);
    expectNoOverlap(pages[0]);
  });

  it("an image in a table cell is not shifted up: the cell grows, and the row that would cross the page end moves whole", () => {
    // Cells are their own BFC: the row moves to the next page with its image
    // (Word), it is not kept on the page by shifting the image up.
    const img = createElementBox("img", { display: "inline-block", float: "inline-start" }, [
      createElementBox("img-img", { display: "block", inlineSize: 100, blockSize: 48 }, []),
    ], { inlineFloat: { blockId: "c" as BlockId, offset: 0, offsetBlock: 0, exclusion: "side" } });
    const cell = createElementBox("c", { display: "table-cell" }, [img, createTextBox("c-t", {}, "ab cd ef gh")]);
    const root = cascadePass(createElementBox("doc", { display: "block" }, [
      createElementBox("p", { display: "block", whiteSpace: "pre" }, [createTextBox("p-t", { whiteSpace: "pre" }, "a\nb")]),
      createElementBox("t", { display: "table" }, [createElementBox("r", { display: "table-row" }, [cell])]),
    ]));
    if (root.type !== "element") throw new Error("cascaded root is not an element");
    const pages = layBoth(root, page(64));
    expect(pages[0]?.floats).toEqual([]);
    expect(pages[1]?.floats.map((f) => f[1])).toEqual([0]);
  });

  it("a body image never narrows the page's header: materialize lays the header as measure does", () => {
    // A 300-wide image at the body's top; the header's two full-width lines
    // would wrap to five beside it.
    const doc = renderDoc([[image(200, "left", { width: 300 }), text(WORDS)]]);
    if (doc.type !== "element") throw new Error("rendered root is not an element");
    const hdr = "hdr" as BlockId;
    const root = cascadePass(createElementBox("root", { display: "block" }, [
      createElementBox("final-section", { display: "contents" }, doc.children, { blockType: "section", headerBlockId: hdr }),
    ]));
    const header = cascadePass(createElementBox("hdr-root", { display: "block" }, [
      createElementBox("h", { display: "block" }, [createTextBox("h-t", {}, WORDS)]),
    ]));
    if (root.type !== "element" || header.type !== "element" || root.computedStyle === undefined) throw new Error("not cascaded");
    const cfg: PageConfig = { ...page(400), pageMargins: { blockStart: 40, blockEnd: 0, inlineStart: 0, inlineEnd: 0 } };
    const tree = buildVirtualPaginatedTree(root, makeRootContext(root.computedStyle, 500), shaper, cfg, undefined, new Map([[hdr, header]]));
    const slot = tree.getPage(0).headerSlot;
    if (slot === null) throw new Error("no header slot");
    expect(slot.blockSize).toBe(32);
    expect(tree.plan.entries[0]?.effectiveTopInset).toBe(40);
    const lines: number[][] = [];
    const walk = (b: LayoutBox): void => {
      if (b.type === "line") lines.push([b.x, b.width]);
      else if ("children" in b) for (const c of b.children) walk(c);
    };
    walk(slot);
    expect(lines).toEqual([[0, 500], [0, 500]]);
  });

  for (const side of ["left", "right"] as const) {
    it(`a rising image is judged over its whole extent: it skips a ${side} image lower down and takes the free spot above it`, () => {
      // Page end 222. p1's 400-wide image sits at [152,202). p2's 300-wide left
      // image is clamped to 122, where it would cover p1's from 152 down: the
      // lowest spot free over all its 100px is [52,152).
      const pages = layBoth([
        [text("a\nb\nc\nd\ne\nf\ng\nh\ni")],
        [image(50, side, { width: 400 }), text("ab")],
        [image(100, "left", { width: 300 }), text("cd")],
      ], page(222));
      expect(pages[0]?.floats.map((f) => [f[1], f[4]])).toEqual([[152, 50], [52, 100]]);
      expectFloatsDisjoint(pages[0]);
      expectNoOverlap(pages[0]);
    });
  }

  it("a forced break inside a container is not undone by the container's overflow rule: the paragraph moves with its image", () => {
    // body = [A, D[P]]. P's 300×80 image rises to [0,80]; beside it A wraps to 5
    // lines and P no longer fits, so P is forced to page 2. D, then empty on
    // page 1, must break before it: re-laid there by the overflow rule, P (one
    // line) fits below a full-width A and its image rises over A again.
    const words = createTextBox("w", {}, WORDS);
    const root = cascadePass(createElementBox("doc", { display: "block" }, [
      createElementBox("A", { display: "block" }, [words]),
      createElementBox("D", { display: "block" }, [
        createElementBox("P", { display: "block" }, [wrappedAtom("img", "P", 300, 80), createTextBox("p-t", {}, "ab")]),
      ]),
    ]));
    if (root.type !== "element") throw new Error("cascaded root is not an element");
    const pages = layBoth(root, page(80));
    expect(pages[0]?.floats).toEqual([]);
    expect(pages[0]?.lines.map((l) => [l[2], l[3]])).toEqual([[0, 500], [0, 500]]);
    expect(pages[1]?.floats.map((f) => [f[1], f[2]])).toEqual([[0, 0]]);
    expect(pages[1]?.lines[0]?.slice(1, 4)).toEqual([0, 300, 200]);
    expectNoOverlap(pages[1]);
  });

  it("a paragraph of short lines split across pages, an image risen to page 2's top: no text duplicated or dropped at the break", () => {
    // P's 15px lines hold 6 words (480px) each: 5 lines [0,75) on page 1, the
    // rest on page 2. Q's 40×80 image rises to page 2's top (75); the re-lay
    // re-wraps P from line 0, and line 4 [60,75) must not see the image (beside
    // it the line would hold only 5 words).
    const P = shortLinePara("P", [], 42);
    const Q = createElementBox("Q", { display: "block" }, [wrappedAtom("img", "Q", 40, 80), createTextBox("q-t", {}, "ab")]);
    const pages = layBoth(cascadedRoot([P, Q]), page(80), sizedShaper());
    const [p1, p2] = [linesOf(pages[0], "P"), linesOf(pages[1], "P")];
    expect(p1.map((l) => [l[1], l[3], l[6]])).toEqual([0, 15, 30, 45, 60].map((y) => [y, 500, 15]));
    expect(pages[1]?.floats.map((f) => [f[1], f[4]])).toEqual([[0, 80]]);
    expect(p2[0]?.[4]).toBe(p1[p1.length - 1]?.[5]);
    expect(p2[p2.length - 1]?.[5]).toBe(42 * 10 - 1);
    expectNoOverlap(pages[1]);
  });

  it("a short line next to an image starting 1px below its bottom keeps full width", () => {
    const P = shortLinePara("P", [wrappedAtom("img", "P", 100, 40, 16)], 14);
    const lines = linesOf(layBoth(cascadedRoot([P]), page(400), sizedShaper())[0], "P");
    // The image is [16,56): line 0 [0,15) is clear of it, lines 1–2 beside it.
    expect(lines.map((l) => [l[1], l[2], l[3]])).toEqual([[0, 0, 500], [15, 100, 400], [30, 100, 400]]);
  });
});
