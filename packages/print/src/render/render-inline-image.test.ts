import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import type { RenderNode, ElementBox } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildDocument } from "@taleweaver/core";
import { buildBlock, inlineContent, text, embed, adaptShaperToMeasurer, createElementBox } from "@taleweaver/core";
import type { InlineItem } from "@taleweaver/core";
import { asBlockId, INLINE_IMAGE_EMBED_TYPE } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { makeRootContext } from "../layout/layout-context";
import type { LayoutBox, InlineBlockBox, LineBox, BlockBox } from "../layout/layout-box";
import type { BreakToken, FragmentationContext } from "../layout/fragmentation";
import { getLineIndex } from "../cursor/line-flatten";
import { buildLineBidiView, inlineCoordForOffset } from "../cursor/line-bidi";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();
const shaper = createMockShaper(8, 16);

/**
 * Locate the single inline-image element box in a render tree (by its
 * `metadata.embedType`). The inline image renders (Option B) as an OUTER
 * `display:inline-block` ElementBox (carrying `metadata.replacedInline: true`
 * so the T2 replaced-baseline rule fires) wrapping ONE INNER `display:block`
 * ElementBox carrying `metadata.image {src,width,height}` + explicit dims — so
 * the existing block-image paint runs for free via `paintContainerChildren`.
 */
function findInlineImage(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    if (node.metadata?.embedType === INLINE_IMAGE_EMBED_TYPE) found = node;
    for (const child of node.children) walk(child);
  }
  walk(root);
  return found;
}

function buildInlineImageDocument() {
  return buildDocument({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([
          text("x"),
          embed(INLINE_IMAGE_EMBED_TYPE, {
            src: "logo.png",
            width: 40,
            height: 30,
            alt: "a",
          }),
        ]),
      }),
    ],
  });
}

describe("render — inline-image embed (Option B inline-block atom)", () => {
  it("renders the inline image as an OUTER inline-block (replacedInline) wrapping an INNER block carrying metadata.image", () => {
    const document = buildInlineImageDocument();
    const out = render(document, reg, attrReg);
    const outer = findInlineImage(out.root);
    expect(outer).not.toBeNull();
    if (outer === null) throw new Error("expected inline-image element box");

    // OUTER: a single-token inline-block atom (one IFC token = the state model's
    // 1-unit EmbedItem offset, #407), flagged replacedInline so the T2
    // bottom-edge baseline rule fires.
    expect(outer.style.display).toBe("inline-block");
    expect(outer.metadata?.replacedInline).toBe(true);

    // INNER: exactly one childless block ElementBox with the image metadata +
    // explicit dims. Reusing the block-image render means paintContainerChildren
    // recursion reaches the existing block-image paint for free.
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0];
    if (inner === undefined || inner.type !== "element") {
      throw new Error("expected one inner element child");
    }
    expect(inner.style.display).toBe("block");
    expect(inner.style.blockSize).toBe(30);
    expect(inner.style.inlineSize).toBe(40);
    expect(inner.children).toHaveLength(0);
    // The exact metadata.image shape components/image.ts stamps: { src, width, height, alt }.
    expect(inner.metadata?.image).toEqual({ src: "logo.png", width: 40, height: 30, alt: "a" });
  });

  it("threads alt from the inline-image embed properties onto the inner block (P-3)", () => {
    const document = buildDocument({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("x"),
            embed(INLINE_IMAGE_EMBED_TYPE, {
              src: "logo.png",
              width: 40,
              height: 30,
              alt: "inline cat",
            }),
          ]),
        }),
      ],
    });
    const out = render(document, reg, attrReg);
    const outer = findInlineImage(out.root);
    if (outer === null) throw new Error("expected inline-image element box");
    const inner = outer.children[0];
    if (inner === undefined || inner.type !== "element") {
      throw new Error("expected one inner element child");
    }
    expect(inner.metadata?.image?.alt).toBe("inline cat");
  });

  it("lays out the inline image so its bottom edge sits on the text baseline (T2 replaced rule)", () => {
    const document = buildInlineImageDocument();
    const out = render(document, reg, attrReg);
    const cascaded = cascadePass(out.root);
    if (cascaded.type !== "element") throw new Error("cascaded root is not an element");
    // The render root is the document; descend to the paragraph block, which is
    // the inline-content-bearing BFC whose IFC produces the line + inline-block.
    const r = layoutBlock(
      cascaded,
      0,
      0,
      makeRootContext(INITIAL_COMPUTED_STYLE, 500),
      shaper,
      undefined,
    );
    if (r.box === null) throw new Error("layoutBlock returned null box");

    // Walk the typed LayoutBox tree to the inline-block box (the OUTER image
    // atom) and its enclosing line. Every variant carries the geometry fields
    // off `LayoutBoxBase`; `isReplaced` is `InlineBlockBox`-only, so we capture
    // the inline-block node itself (no structural cast).
    let imageBox: InlineBlockBox | null = null;
    let lineBlockSize = 0;
    function walk(box: LayoutBox): void {
      if (box.type === "line") lineBlockSize = box.blockSize;
      if (box.type === "inline-block") imageBox = box;
      if ("children" in box) {
        for (const child of box.children) walk(child);
      }
    }
    walk(r.box);

    if (imageBox === null) throw new Error("inline-block image box not found in layout");
    const ib: InlineBlockBox = imageBox;

    // The OUTER inline-block carries the image's explicit dims.
    expect(ib.blockSize).toBe(30);
    expect(ib.inlineSize).toBe(40);
    // The replaced flag survived render→cascade→layout (metadata.replacedInline
    // → IFC inlineBlock.isReplaced).
    expect(ib.isReplaced).toBe(true);
    // T2 replaced-baseline rule: bottom edge on the text baseline
    // (lineBlockSize*0.8) → blockOffset = lineBlockSize*0.8 − blockSize.
    expect(ib.blockOffset).toBe(lineBlockSize * 0.8 - ib.blockSize);
    expect(ib.blockOffset).toBe(ib.y);
  });
});

// ── Wrapped inline images: floats at the paragraph top (P3 M1a) ──────────────
//
// Mock shaper: 8px per char, 16px lines. Content width 500; image 100×32 = two
// line heights, so a paragraph's lines at y=0 / y=16 sit beside it and y≥32 is
// full width.

const WORDS = "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";

function wrapped(wrap: string, extra: Record<string, unknown> = {}): InlineItem {
  return embed(INLINE_IMAGE_EMBED_TYPE, { src: "i.png", width: 100, height: 32, wrap, ...extra });
}

interface LaidPara { readonly box: BlockBox; readonly lines: readonly LineBox[]; readonly floats: readonly BlockBox[] }

function layoutParas(
  paras: readonly InlineItem[][],
  opts: {
    readonly width?: number;
    readonly rtl?: boolean;
    readonly pre?: boolean;
    readonly fragmentation?: FragmentationContext;
    readonly pageFlowBase?: number;
  } = {},
): {
  readonly root: LayoutBox;
  readonly paras: readonly LaidPara[];
  readonly breakToken: BreakToken | null;
  readonly inFlowConsumed: number;
} {
  const ids = paras.map((_, k) => `p${k}`);
  const first = ids[0] ?? "p0";
  const last = ids[ids.length - 1] ?? "p0";
  const document = buildDocument({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: first, lastChildId: last }),
      ...paras.map((items, k) => buildBlock({
        id: `p${k}`,
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: k > 0 ? `p${k - 1}` : null,
        nextSiblingId: k < paras.length - 1 ? `p${k + 1}` : null,
        attrs: opts.rtl === true ? { dir: "rtl" } : opts.pre === true ? { whiteSpace: "pre" } : undefined,
        inlineContent: inlineContent(items),
      })),
    ],
  });
  const registry = createDefaultAttrRegistry();
  registry.register({ attrKey: "dir", toStyle: (v) => (v === "rtl" ? { direction: "rtl" } : {}) });
  // The document model has no direction attr yet: an RTL test supplies it at
  // render (a block attr → the render-time computed direction `wrap` resolves
  // against, as for block images) AND at layout (an RTL root the tree inherits).
  const rendered = render(document, reg, registry).root;
  const cascaded = cascadePass(
    opts.rtl === true ? createElementBox("rtl", { display: "block", direction: "rtl" }, [rendered]) : rendered,
  );
  if (cascaded.type !== "element") throw new Error("cascaded root is not an element");
  const r = layoutBlock(
    cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, opts.width ?? 500), shaper, undefined, opts.fragmentation,
    opts.pageFlowBase,
  );
  if (r.box === null || r.box.type !== "block") throw new Error("layoutBlock returned no block");
  const docBox = opts.rtl === true ? r.box.children[0] : r.box;
  if (docBox === undefined || docBox.type !== "block") throw new Error("no document box");
  const out: LaidPara[] = [];
  for (const c of docBox.children) {
    if (c.type !== "block") continue;
    out.push({
      box: c,
      lines: c.children.filter((l): l is LineBox => l.type === "line"),
      floats: c.children.filter((f): f is BlockBox => f.type === "block"),
    });
  }
  return { root: r.box, paras: out, breakToken: r.breakToken, inFlowConsumed: r.inFlowConsumed };
}

function only<T>(xs: readonly T[]): T {
  const [x] = xs;
  if (x === undefined || xs.length !== 1) throw new Error(`expected exactly one, got ${xs.length}`);
  return x;
}

function lineAt(p: LaidPara, k: number): LineBox {
  const l = p.lines[k];
  if (l === undefined) throw new Error(`no line ${k}`);
  return l;
}

function para(r: { readonly paras: readonly LaidPara[] }, k: number): LaidPara {
  const p = r.paras[k];
  if (p === undefined) throw new Error(`no paragraph ${k}`);
  return p;
}

describe("render — wrapped inline image (inline-image `wrap`)", () => {
  it("stamps float + inlineFloat (anchor block, state offset, offsetBlock, exclusion) on the outer atom, still one inline-block", () => {
    const document = buildDocument({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("abc"), wrapped("right", { offsetBlock: 12 })]) }),
      ],
    });
    const outer = findInlineImage(render(document, reg, attrReg).root);
    if (outer === null) throw new Error("expected inline-image element box");
    expect(outer.style.display).toBe("inline-block");
    expect(outer.style.float).toBe("inline-end");
    expect(outer.metadata?.inlineFloat).toEqual({ blockId: "p", offset: 3, offsetBlock: 12, exclusion: "side" });
  });

  it("break → inline-start with a full exclusion; no wrap → no float", () => {
    const doc = (item: InlineItem) => buildDocument({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([item]) }),
      ],
    });
    const brk = findInlineImage(render(doc(wrapped("break")), reg, attrReg).root);
    expect(brk?.style.float).toBe("inline-start");
    expect(brk?.metadata?.inlineFloat?.exclusion).toBe("full");
    expect(brk?.metadata?.inlineFloat?.offsetBlock).toBe(0);
    const plain = findInlineImage(render(doc(embed(INLINE_IMAGE_EMBED_TYPE, { src: "i.png", width: 10, height: 10 })), reg, attrReg).root);
    expect(plain?.style.float).toBeUndefined();
    expect(plain?.metadata?.inlineFloat).toBeUndefined();
  });
});

describe("layout — wrapped inline image floats at its paragraph top", () => {
  it("left: float at the paragraph top-left; the first two lines are shortened by its width, later lines full", () => {
    const p = para(layoutParas([[wrapped("left"), text(WORDS)]]), 0);
    const f = only(p.floats);
    expect(f.metadata?.inlineFloat).toEqual({ blockId: "p0", offset: 0, offsetBlock: 0, exclusion: "side" });
    expect([f.x, f.y, f.width, f.height]).toEqual([0, 0, 100, 32]);
    expect(p.lines.length).toBeGreaterThanOrEqual(3);
    for (const k of [0, 1]) {
      expect([lineAt(p, k).x, lineAt(p, k).width]).toEqual([100, 400]);
    }
    expect([lineAt(p, 2).y, lineAt(p, 2).x, lineAt(p, 2).width]).toEqual([32, 0, 500]);
    // The float box is a child of the paragraph box, before its lines.
    expect(p.box.children[0]).toBe(f);
  });

  it("right: float at the paragraph top-right; the first lines end at its edge", () => {
    const p = para(layoutParas([[wrapped("right"), text(WORDS)]]), 0);
    const f = only(p.floats);
    expect([f.x, f.y, f.width, f.height]).toEqual([400, 0, 100, 32]);
    expect([lineAt(p, 0).x, lineAt(p, 0).width]).toEqual([0, 400]);
    expect([lineAt(p, 2).x, lineAt(p, 2).width]).toEqual([0, 500]);
  });

  it("break: every line of the paragraph is below the image, full width — also a paragraph holding only the image", () => {
    const r = layoutParas([[wrapped("break"), text(WORDS)], [wrapped("break")]]);
    const p = para(r, 0);
    const f = only(p.floats);
    expect([f.x, f.y, f.width, f.height]).toEqual([0, 0, 100, 32]);
    expect(lineAt(p, 0).y).toBe(32);
    for (const l of p.lines) {
      expect(l.y).toBeGreaterThanOrEqual(32);
      expect([l.x, l.width]).toEqual([0, 500]);
    }
    // The placeholder rides on the first line (offsets 0..), not on a line of its own.
    expect(lineAt(p, 0).inlineOffsetStart).toBe(0);
    // A paragraph holding only the image: its (¶) line goes below the image too.
    const q = para(r, 1);
    const g = only(q.floats);
    expect(only(q.lines).y).toBe(g.y + 32);
  });

  it("break in a `pre` paragraph: the lines still go below the image (no line beside a full-width exclusion)", () => {
    const p = para(layoutParas([[wrapped("break"), text("ab\ncd")]], { pre: true }), 0);
    for (const l of p.lines) {
      expect(l.y).toBeGreaterThanOrEqual(32);
      expect([l.x, l.width]).toEqual([0, 500]);
    }
  });

  it("a paragraph that moves whole to the next page takes its float with it", () => {
    const paras = [[text("ab")], [wrapped("left"), text(WORDS)]];
    // p0 = one 16px line + 8px margin; p1's first line (24..40) does not fit in 30.
    const page1 = layoutParas(paras, { fragmentation: { availableBlockSize: 30, pageIndex: 0, resumeFrom: null } });
    expect(page1.paras.flatMap((q) => q.floats)).toEqual([]);
    expect(page1.breakToken).not.toBeNull();
    const page2 = layoutParas(paras, {
      fragmentation: { availableBlockSize: 1000, pageIndex: 1, resumeFrom: page1.breakToken },
      pageFlowBase: page1.inFlowConsumed,
    });
    const p = page2.paras[page2.paras.length - 1];
    if (p === undefined) throw new Error("no paragraph on page 2");
    const f = only(p.floats);
    expect(f.y).toBe(lineAt(p, 0).y);
    expect([lineAt(p, 0).x, lineAt(p, 0).width]).toEqual([100, 400]);
  });

  it("offsetBlock moves the float down from the paragraph top", () => {
    const p = para(layoutParas([[wrapped("left", { offsetBlock: 16 }), text(`${WORDS} ${WORDS}`)]]), 0);
    const f = only(p.floats);
    expect([f.x, f.y]).toEqual([0, 16]);
    expect([lineAt(p, 0).x, lineAt(p, 0).width]).toEqual([0, 500]);
    expect([lineAt(p, 1).x, lineAt(p, 1).width]).toEqual([100, 400]);
    expect([lineAt(p, 2).x, lineAt(p, 2).width]).toEqual([100, 400]);
    expect([lineAt(p, 3).x, lineAt(p, 3).width]).toEqual([0, 500]);
  });

  it("RTL mirrors the physical side: left stays physically left (inline-end), right physically right", () => {
    const rtl = { rtl: true };
    const l = para(layoutParas([[wrapped("left"), text(WORDS)]], rtl), 0);
    const lf = only(l.floats);
    expect(lf.computedStyle.float).toBe("inline-end");
    expect([lf.x, lf.width]).toEqual([0, 100]);
    expect([lineAt(l, 0).x, lineAt(l, 0).width]).toEqual([100, 400]);
    const r = para(layoutParas([[wrapped("right"), text(WORDS)]], rtl), 0);
    const rf = only(r.floats);
    expect(rf.computedStyle.float).toBe("inline-start");
    expect([rf.x, rf.width]).toEqual([400, 100]);
    expect([lineAt(r, 0).x, lineAt(r, 0).width]).toEqual([0, 400]);
  });

  it("an embed mid-paragraph still floats at the PARAGRAPH top", () => {
    const p = para(layoutParas([[text(WORDS), wrapped("left"), text(WORDS)]]), 0);
    const f = only(p.floats);
    expect([f.x, f.y]).toEqual([0, 0]);
    expect(f.metadata?.inlineFloat?.offset).toBe(WORDS.length);
    expect([lineAt(p, 0).x, lineAt(p, 0).width]).toEqual([100, 400]);
  });

  it("the placeholder owns exactly one offset: caret offsets after it on its line map exactly", () => {
    const r = layoutParas([[text("ab"), wrapped("left"), text("cd")]]);
    const p = para(r, 0);
    const line = only(p.lines);
    expect([line.inlineOffsetStart, line.inlineOffsetEnd]).toEqual([0, 5]);
    const ph = line.children.find((c) => c.type === "inline-block");
    expect(ph?.inlineSize).toBe(0);
    expect(ph?.type === "inline-block" ? ph.floatKey : undefined).toBe(only(p.floats).key);
    const alb = only(getLineIndex(r.root).all);
    const view = buildLineBidiView(alb);
    expect(view.logicalLeaves.map((l) => [l.logStart, l.logEnd])).toEqual([[0, 2], [2, 3], [3, 5]]);
    const measurer = adaptShaperToMeasurer(shaper);
    // line x = 100 (beside the float); "ab" = 16px, placeholder 0px, "c" = 8px.
    expect(inlineCoordForOffset(view, 3, undefined, measurer)).toBe(116);
    expect(inlineCoordForOffset(view, 4, undefined, measurer)).toBe(124);
  });

  it("is not a line-break opportunity: a float between two runs breaks exactly like the runs alone", () => {
    // width 80 = 10 chars; the float sits far below (offsetBlock) so it does not narrow lines.
    const far = wrapped("left", { offsetBlock: 1000 });
    const lineSpans = (items: InlineItem[]) =>
      para(layoutParas([items], { width: 80 }), 0).lines.map((l) => [l.inlineOffsetStart, l.inlineOffsetEnd]);
    // Mid-word: "yyyy|zzzz" (bold keeps the runs apart) breaks the same with
    // the float between the runs: the float only adds its one offset (at 9),
    // glued to "yyyy".
    const bold = text("zzzz", { bold: true });
    const shift = (o: number) => (o >= 9 ? o + 1 : o);
    expect(lineSpans([text("xxxx yyyy"), far, bold])).toEqual(
      lineSpans([text("xxxx yyyy"), bold]).map((span) => span.map(shift)),
    );
    // After a space the break stays where it was, and the float stays with the content before it.
    expect(lineSpans([text("xxxx yyyy "), far, text("zzzz")])).toEqual([[0, 11], [11, 15]]);
    expect(lineSpans([text("xxxx yyyy zzzz")])).toEqual([[0, 10], [10, 14]]);
  });

  it("a following paragraph wraps around a float that extends below its paragraph", () => {
    const r = layoutParas([[text("ab"), wrapped("left")], [text(WORDS)]]);
    const p0 = para(r, 0);
    const p1 = para(r, 1);
    expect(only(p0.lines).width).toBe(400);
    // p0 is one 16px line + the paragraph's 8px bottom margin: p1 starts at
    // y=24, inside the float's 0..32 band, so only its first line is beside it.
    expect(p0.box.height).toBe(16);
    expect(p1.box.y).toBe(24);
    expect([lineAt(p1, 0).x, lineAt(p1, 0).width]).toEqual([100, 400]);
    expect([lineAt(p1, 1).x, lineAt(p1, 1).width]).toEqual([0, 500]);
  });
});
