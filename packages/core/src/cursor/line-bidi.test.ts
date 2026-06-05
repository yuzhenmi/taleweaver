import { describe, it, expect } from "vitest";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import type { TextShaper } from "../layout/text-shaper";
import { adaptShaperToMeasurer } from "../layout/text-measurer";
import type { TextMeasurer } from "../layout/text-measurer";
import { buildState, buildBlock, text, inlineContent, embed } from "../test-utils/state-builders";
import { cascadePass } from "../cascade";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import { collectFootnoteAnchors } from "../footnotes";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "../state";
import type { ElementBox, RenderNode } from "../render/render-node";
import type { PageConfig } from "../layout/page-config";
import type { BlockId, State } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import { getLineIndex } from "./line-flatten";
import type { AbsoluteLineBox } from "./line-flatten";
import {
  buildLineBidiView,
  caretXInLeaf,
  offsetInLeaf,
} from "./line-bidi";

const CHAR_W = 8;
const LINE_H = 16;

function pipeline(state: State): { layout: LayoutBox; measurer: TextMeasurer } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper: TextShaper = createMockShaper(CHAR_W, LINE_H);
  const layout = resolvePositionedTree(layoutTree(root, 800, shaper));
  return { layout, measurer: adaptShaperToMeasurer(shaper) };
}

/**
 * Single-paragraph doc with the given text + optional `direction` attr (so we
 * can seed an RTL-base paragraph). Mirrors the cursor-position test pattern.
 */
function para(textContent: string, attrs?: Record<string, string>): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs,
        inlineContent: inlineContent([text(textContent)]),
      }),
    ],
  });
}

/** The single body line for block "p". */
function bodyLine(layout: LayoutBox): AbsoluteLineBox {
  const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
  expect(lines.length).toBeGreaterThan(0);
  return lines[0];
}

describe("buildLineBidiView", () => {
  it("LTR-only line: single leaf, level 0, contiguous state span from inlineOffsetStart", () => {
    const state = para("abc");
    const { layout } = pipeline(state);
    const alb = bodyLine(layout);
    const view = buildLineBidiView(alb);

    expect(view.isEmpty).toBe(false);
    expect(view.paragraphDirection).toBe("ltr");
    expect(view.logicalLeaves.length).toBe(1);
    expect(view.visualLeaves.length).toBe(1);
    const leaf = view.logicalLeaves[0];
    expect(leaf.level).toBe(0);
    expect(leaf.logStart).toBe(alb.line.inlineOffsetStart);
    expect(leaf.logEnd).toBe(alb.line.inlineOffsetEnd);
  });

  it("mixed Latin+Hebrew: logical order ascending sourceStart, contiguous spans, level parity per run", () => {
    // "abc אבג" in an LTR paragraph: Latin "abc " (level 0) + Hebrew "אבג"
    // (level 1). The reorder puts the Hebrew run before/after in VISUAL order,
    // but logical order (ascending sourceStart) keeps [Latin, Hebrew].
    const state = para("abc אבג");
    const { layout } = pipeline(state);
    const alb = bodyLine(layout);
    const view = buildLineBidiView(alb);

    expect(view.isEmpty).toBe(false);
    expect(view.paragraphDirection).toBe("ltr");
    // At least two non-synthetic leaves (the Latin segment + the Hebrew
    // segment; the inter-word space may tokenize into its own run, giving 3).
    expect(view.logicalLeaves.length).toBeGreaterThanOrEqual(2);

    // Logical order is STRICTLY ascending sourceStart.
    const ss = view.logicalLeaves.map((l) => l.leaf.box.sourceStart as number);
    for (let k = 1; k < ss.length; k++) {
      expect(ss[k]).toBeGreaterThan(ss[k - 1]);
    }

    // Spans are contiguous and cover the whole line state range.
    expect(view.logicalLeaves[0].logStart).toBe(alb.line.inlineOffsetStart);
    for (let k = 1; k < view.logicalLeaves.length; k++) {
      expect(view.logicalLeaves[k].logStart).toBe(view.logicalLeaves[k - 1].logEnd);
    }
    expect(view.logicalLeaves[view.logicalLeaves.length - 1].logEnd).toBe(
      alb.line.inlineOffsetEnd,
    );

    // Level parity: the Latin leaf is even (LTR), the Hebrew leaf odd (RTL).
    const latin = view.logicalLeaves.find(
      (l) => l.leaf.kind === "text-run" && l.leaf.box.text.includes("a"),
    );
    const hebrew = view.logicalLeaves.find(
      (l) => l.leaf.kind === "text-run" && l.leaf.box.text.includes("א"),
    );
    expect(latin).toBeDefined();
    expect(hebrew).toBeDefined();
    if (latin) expect(latin.level % 2).toBe(0);
    if (hebrew) expect(hebrew.level % 2).toBe(1);
  });

  it("visualLeaves and logicalLeaves reference the SAME BidiViewLeaf objects", () => {
    const state = para("abc אבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    // Every object in logicalLeaves must also be in visualLeaves (same refs).
    for (const lv of view.logicalLeaves) {
      expect(view.visualLeaves).toContain(lv);
    }
    expect(view.visualLeaves.length).toBe(view.logicalLeaves.length);
  });

  it("uniform Hebrew (RTL run in LTR paragraph): single leaf, odd level, contiguous span", () => {
    // Note: there is no `direction` block attr in the registry, so the
    // paragraph base stays LTR; the Hebrew CONTENT still resolves to a level-1
    // (RTL) run by UAX #9 — which is what the §B/§C intra-leaf RTL math keys
    // off (the leaf level parity, not the paragraph direction).
    const state = para("אבג");
    const { layout } = pipeline(state);
    const alb = bodyLine(layout);
    const view = buildLineBidiView(alb);

    expect(view.isEmpty).toBe(false);
    expect(view.logicalLeaves.length).toBe(1);
    expect(view.logicalLeaves[0].level % 2).toBe(1);
    expect(view.logicalLeaves[0].logStart).toBe(alb.line.inlineOffsetStart);
    expect(view.logicalLeaves[0].logEnd).toBe(alb.line.inlineOffsetEnd);
  });

  it("empty line (strut only): isEmpty true, no leaves", () => {
    const state = para("");
    const { layout } = pipeline(state);
    const alb = bodyLine(layout);
    const view = buildLineBidiView(alb);

    expect(view.isEmpty).toBe(true);
    expect(view.logicalLeaves.length).toBe(0);
    expect(view.visualLeaves.length).toBe(0);
  });

  it("text-transform: uppercase ß→SS MIXED with Hebrew: logical order by SOURCE, span = STATE length (C-1 regression)", () => {
    // "aß אב" with text-transform: uppercase. The "ß" expands to "SS" in the
    // DISPLAY string (so the Latin leaf renders wider than its state length),
    // but its STATE span (logEnd - logStart) must equal the SOURCE length, and
    // logical order is by source, NOT by display width.
    const state = para("aß אב", { textTransform: "uppercase" });
    const { layout } = pipeline(state);
    const alb = bodyLine(layout);
    const view = buildLineBidiView(alb);

    expect(view.isEmpty).toBe(false);
    // Logical order ascending sourceStart.
    const ss = view.logicalLeaves.map((l) => l.leaf.box.sourceStart as number);
    for (let k = 1; k < ss.length; k++) {
      expect(ss[k]).toBeGreaterThan(ss[k - 1]);
    }
    // Contiguous, covering the full STATE range.
    expect(view.logicalLeaves[0].logStart).toBe(alb.line.inlineOffsetStart);
    for (let k = 1; k < view.logicalLeaves.length; k++) {
      expect(view.logicalLeaves[k].logStart).toBe(view.logicalLeaves[k - 1].logEnd);
    }
    expect(view.logicalLeaves[view.logicalLeaves.length - 1].logEnd).toBe(
      alb.line.inlineOffsetEnd,
    );

    // The Latin leaf containing the ß: its state span is 2 ("a" + "ß"), NOT 3
    // (the display "ASS" is 3 units but the source is 2 state code units). If
    // the builder accumulated by display length this would be 3 — the bug.
    const latinLeaf = view.logicalLeaves.find(
      (l) => l.leaf.kind === "text-run" && /[A-Za-zß]/.test(l.leaf.box.text),
    );
    expect(latinLeaf).toBeDefined();
    if (latinLeaf) {
      // "a" + "ß" = 2 state code units owned by this leaf.
      expect(latinLeaf.logEnd - latinLeaf.logStart).toBe(2);
    }
  });

  it("hyphenated line: synthetic hyphen run excluded from leaves", () => {
    // Force a hyphenation by giving a long hyphenatable word in a narrow box.
    // The synthetic hyphen run has offsetLength === 0 && sourceStart === undefined.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { hyphens: "auto", lang: "en" },
          inlineContent: inlineContent([text("hyphenation")]),
        }),
      ],
    });
    const root = render(
      state,
      createDefaultComponentRegistry(),
      createDefaultAttrRegistry(),
    ).root;
    const shaper: TextShaper = createMockShaper(CHAR_W, LINE_H);
    // Narrow container to force a wrap inside the word.
    const layout = resolvePositionedTree(layoutTree(root, 40, shaper));
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    for (const alb of lines) {
      const view = buildLineBidiView(alb);
      // No synthetic run (text-run with offsetLength 0 && sourceStart
      // undefined) should survive. An inline-block is never synthetic.
      for (const lv of view.logicalLeaves) {
        const isSynthetic =
          lv.leaf.kind === "text-run" &&
          lv.leaf.box.offsetLength === 0 &&
          lv.leaf.box.sourceStart === undefined;
        expect(isSynthetic).toBe(false);
      }
    }
  });
});

describe("caretXInLeaf / offsetInLeaf", () => {
  it("LTR run: caret X strictly increasing in stateOffset; round-trips", () => {
    const state = para("abc");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = view.logicalLeaves[0];

    const xs: number[] = [];
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      xs.push(caretXInLeaf(leaf, off, measurer));
    }
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }

    // offsetInLeaf round-trips caretXInLeaf for an interior offset.
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      const x = caretXInLeaf(leaf, off, measurer);
      const localX = x - leaf.leaf.absoluteX;
      expect(offsetInLeaf(leaf, localX, measurer)).toBe(off);
    }
  });

  it("RTL run (uniform Hebrew): caret X strictly DECREASING in stateOffset; round-trips", () => {
    const state = para("אבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = view.logicalLeaves[0];
    expect(leaf.level % 2).toBe(1);

    const xs: number[] = [];
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      xs.push(caretXInLeaf(leaf, off, measurer));
    }
    // Logically-later offset sits at a LOWER x under RTL.
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeLessThan(xs[i - 1]);
    }

    // offsetInLeaf round-trips for RTL too.
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      const x = caretXInLeaf(leaf, off, measurer);
      const localX = x - leaf.leaf.absoluteX;
      expect(offsetInLeaf(leaf, localX, measurer)).toBe(off);
    }
  });

  it("caretXInLeaf RTL endpoints: logStart at leaf right edge, logEnd at left edge", () => {
    const state = para("אבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = view.logicalLeaves[0];

    const xStart = caretXInLeaf(leaf, leaf.logStart, measurer);
    const xEnd = caretXInLeaf(leaf, leaf.logEnd, measurer);
    expect(xStart).toBeCloseTo(leaf.leaf.absoluteX + leaf.leaf.width, 5);
    expect(xEnd).toBeCloseTo(leaf.leaf.absoluteX, 5);
  });

  it("inline-block leaf: caretXInLeaf returns the two edges; offsetInLeaf maps by midpoint", () => {
    // A footnote anchor renders as an inline-block call-marker (one atomic IFC
    // token = one cursor stop). Build it through the real footnote producer so
    // the leaf is a genuine InlineBlockBox (no `.text`).
    const FN_BODY = "fn-body" as BlockId;
    const FN_BODY_P = "fn-body-p" as BlockId;
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: FN_BODY }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: FN_BODY,
          type: "footnote-body",
          firstChildId: FN_BODY_P,
          lastChildId: FN_BODY_P,
        }),
        buildBlock({
          id: FN_BODY_P,
          type: "paragraph",
          parentId: FN_BODY,
          inlineContent: inlineContent([text("note")]),
        }),
      ],
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
    const footnoteAnchors = collectFootnoteAnchors(state);
    const cfg: PageConfig = {
      pageInlineSize: 320,
      pageBlockSize: 400,
      pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 0, inlineEnd: 0 },
      pageGap: 24,
    };
    const shaper: TextShaper = createMockShaper(CHAR_W, LINE_H);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
    const virtual = buildVirtualPaginatedTree(
      cascadedRoot,
      ctx,
      shaper,
      cfg,
      undefined,
      new Map(),
      cascadedEmbedContents,
      footnoteAnchors,
    );
    const positioned = resolvePositionedTree(virtual);
    const measurer = adaptShaperToMeasurer(shaper);

    const lines = getLineIndex(positioned).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBe(1);
    const view = buildLineBidiView(lines[0]);

    // The inline-block leaf owns one state unit; find it.
    const ib = view.logicalLeaves.find((l) => l.leaf.kind === "inline-block");
    expect(ib).toBeDefined();
    if (ib === undefined) return;
    expect(ib.logEnd - ib.logStart).toBe(1);

    // caretXInLeaf: leading edge at logStart, trailing edge at logEnd.
    expect(caretXInLeaf(ib, ib.logStart, measurer)).toBeCloseTo(ib.leaf.absoluteX, 5);
    expect(caretXInLeaf(ib, ib.logEnd, measurer)).toBeCloseTo(
      ib.leaf.absoluteX + ib.leaf.width,
      5,
    );

    // offsetInLeaf: left half → logStart, right half → logEnd (midpoint split).
    expect(offsetInLeaf(ib, ib.leaf.width * 0.25, measurer)).toBe(ib.logStart);
    expect(offsetInLeaf(ib, ib.leaf.width * 0.75, measurer)).toBe(ib.logEnd);
  });
});
