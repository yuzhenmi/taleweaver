import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { buildState, buildBlock, text, inlineContent, embed } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import { collectFootnoteAnchors } from "@taleweaver/core";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import { getLineIndex } from "./line-flatten";
import type { AbsoluteLineBox } from "./line-flatten";
import {
  buildLineBidiView,
  caretInlineCoordInLeaf,
  findLeafOwner,
  inlineCoordForOffset,
  offsetInLeaf,
  moveVisually,
  selectionRectsForLineRange,
  type GraphemeStepper,
  type MoveVisuallyResult,
} from "./line-bidi";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
} from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const CHAR_W = 8;
const LINE_H = 16;

function pipeline(state: State): { layout: LayoutBox; measurer: TextMeasurer } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper: TextShaper = createMockShaper(CHAR_W, LINE_H);
  const layout = positionTreeForTest(layoutTree(root, 800, shaper));
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
  return nth(lines, 0, "line");
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
    const leaf = nth(view.logicalLeaves, 0, "leaf");
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
      expect(nth(ss, k, "sourceStart")).toBeGreaterThan(nth(ss, k - 1, "sourceStart"));
    }

    // Spans are contiguous and cover the whole line state range.
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").logStart).toBe(alb.line.inlineOffsetStart);
    for (let k = 1; k < view.logicalLeaves.length; k++) {
      expect(nth(view.logicalLeaves, k, "logicalLeaves").logStart).toBe(nth(view.logicalLeaves, k - 1, "logicalLeaves").logEnd);
    }
    expect(nth(view.logicalLeaves, view.logicalLeaves.length - 1, "logicalLeaves").logEnd).toBe(
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
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").level % 2).toBe(1);
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").logStart).toBe(alb.line.inlineOffsetStart);
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").logEnd).toBe(alb.line.inlineOffsetEnd);
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
      expect(nth(ss, k, "sourceStart")).toBeGreaterThan(nth(ss, k - 1, "sourceStart"));
    }
    // Contiguous, covering the full STATE range.
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").logStart).toBe(alb.line.inlineOffsetStart);
    for (let k = 1; k < view.logicalLeaves.length; k++) {
      expect(nth(view.logicalLeaves, k, "logicalLeaves").logStart).toBe(nth(view.logicalLeaves, k - 1, "logicalLeaves").logEnd);
    }
    expect(nth(view.logicalLeaves, view.logicalLeaves.length - 1, "logicalLeaves").logEnd).toBe(
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
    const layout = positionTreeForTest(layoutTree(root, 40, shaper));
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

describe("findLeafOwner", () => {
  // "abc אבג" tokenizes into >=2 logical leaves (Latin segment + Hebrew
  // segment, possibly a separate space run). We derive the interior boundary
  // from the actual leaves rather than hardcoding offsets, so the assertions
  // stay robust to tokenization details — what matters is the dual-caret
  // ownership rule at the shared boundary `leafA.logEnd === leafB.logStart`.
  function mixedLeaves() {
    const state = para("abc אבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    expect(view.logicalLeaves.length).toBeGreaterThanOrEqual(2);
    return view.logicalLeaves;
  }

  it("'before' at an interior leaf boundary returns the leaf ENDING there", () => {
    const leaves = mixedLeaves();
    const ending = nth(leaves, 0, "leaf");
    const next = nth(leaves, 1, "leaf");
    const boundary = ending.logEnd;
    expect(boundary).toBe(next.logStart); // contiguous, shared boundary
    expect(findLeafOwner(leaves, boundary, "before")).toBe(ending);
  });

  it("'after' (and undefined) at the same boundary returns the leaf STARTING there", () => {
    const leaves = mixedLeaves();
    const next = nth(leaves, 1, "leaf");
    const boundary = nth(leaves, 0, "leaves").logEnd;
    expect(findLeafOwner(leaves, boundary, "after")).toBe(next);
    expect(findLeafOwner(leaves, boundary, undefined)).toBe(next);
  });

  it("an interior (non-boundary) offset returns the single owning leaf unambiguously", () => {
    const leaves = mixedLeaves();
    const first = nth(leaves, 0, "leaf");
    // A strictly-interior offset only exists when the first leaf spans >1
    // state unit; the Latin "abc " segment does. Affinity is irrelevant here.
    expect(first.logEnd - first.logStart).toBeGreaterThan(1);
    const interior = first.logStart + 1;
    expect(findLeafOwner(leaves, interior, "before")).toBe(first);
    expect(findLeafOwner(leaves, interior, "after")).toBe(first);
    expect(findLeafOwner(leaves, interior, undefined)).toBe(first);
  });

  it("at the very last offset (no next leaf) returns the last leaf regardless of affinity", () => {
    const leaves = mixedLeaves();
    const last = nth(leaves, leaves.length - 1, "leaf");
    expect(findLeafOwner(leaves, last.logEnd, "before")).toBe(last);
    expect(findLeafOwner(leaves, last.logEnd, "after")).toBe(last);
    expect(findLeafOwner(leaves, last.logEnd, undefined)).toBe(last);
  });
});

describe("inlineCoordForOffset", () => {
  // The #503 selection visual-extent fixture: "ab זאב cd" (8px/glyph mock
  // shaper). Logical: a0 b1 sp2 ז3 א4 ב5 sp6 c7 d8. Hebrew run [3,6) is RTL.
  // Confirmed leaf geometry (from the real bidi view):
  //   "ab"  [0,2) LTR absX=0  w=16
  //   " "   [2,3) LTR absX=16 w=8   → right edge x=24
  //   "זאב" [3,6) RTL absX=24 w=24  → logStart(off3)=48, logEnd(off6)=24
  //   " "   [6,7) LTR absX=48 w=8
  //   "cd"  [7,9) LTR absX=56 w=16
  // Visual L→R: a[0] b[8] sp[16] ב[24] א[32] ז[40] sp[48] c[56] d[64].
  function fixture() {
    const state = para("ab זאב cd");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    return { view, measurer };
  }

  it("offset 3 'after' resolves to the Hebrew run's right visual edge (48)", () => {
    const { view, measurer } = fixture();
    expect(inlineCoordForOffset(view, 3, "after", measurer)).toBe(48);
  });

  it("offset 3 'before' resolves to the Latin space's right edge (24)", () => {
    const { view, measurer } = fixture();
    expect(inlineCoordForOffset(view, 3, "before", measurer)).toBe(24);
  });

  it("offset 4 'before' is one glyph into the Hebrew run from the visual right (40)", () => {
    const { view, measurer } = fixture();
    // off4 is interior to the Hebrew leaf [3,6); affinity is inert there.
    expect(inlineCoordForOffset(view, 4, "before", measurer)).toBe(40);
    expect(inlineCoordForOffset(view, 4, "after", measurer)).toBe(40);
  });

  it("pure-LTR offset equals caretInlineCoordInLeaf computed directly (clamp adds nothing)", () => {
    // offset 1 lands inside the "ab" LTR leaf [0,2). The function only adds the
    // leaf-edge clamp on top of caretInlineCoordInLeaf, so for an interior
    // pure-LTR offset (already within its leaf box) the two must agree exactly.
    const { view, measurer } = fixture();
    const owner = findLeafOwner(view.logicalLeaves, 1, "after");
    const direct = caretInlineCoordInLeaf(owner, 1, measurer, view.axisMap);
    expect(inlineCoordForOffset(view, 1, "after", measurer)).toBe(direct);
    expect(direct).toBe(8); // a[0] b[8]: caret after "a" sits at x=8
  });

  it("empty (strut-only) line returns the defensive 0", () => {
    const empty = para("");
    const { layout, measurer } = pipeline(empty);
    const view = buildLineBidiView(bodyLine(layout));
    expect(view.isEmpty).toBe(true);
    expect(inlineCoordForOffset(view, 0, undefined, measurer)).toBe(0);
  });
});

describe("caretInlineCoordInLeaf / offsetInLeaf", () => {
  it("LTR run: caret X strictly increasing in stateOffset; round-trips", () => {
    const state = para("abc");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = nth(view.logicalLeaves, 0, "leaf");

    const xs: number[] = [];
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      xs.push(caretInlineCoordInLeaf(leaf, off, measurer, view.axisMap));
    }
    for (let i = 1; i < xs.length; i++) {
      expect(nth(xs, i, "x")).toBeGreaterThan(nth(xs, i - 1, "x"));
    }

    // offsetInLeaf round-trips caretInlineCoordInLeaf for an interior offset.
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      const x = caretInlineCoordInLeaf(leaf, off, measurer, view.axisMap);
      const localX = x - leaf.leaf.absoluteX;
      expect(offsetInLeaf(leaf, localX, measurer, view.axisMap)).toBe(off);
    }
  });

  it("RTL run (uniform Hebrew): caret X strictly DECREASING in stateOffset; round-trips", () => {
    const state = para("אבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = nth(view.logicalLeaves, 0, "leaf");
    expect(leaf.level % 2).toBe(1);

    const xs: number[] = [];
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      xs.push(caretInlineCoordInLeaf(leaf, off, measurer, view.axisMap));
    }
    // Logically-later offset sits at a LOWER x under RTL.
    for (let i = 1; i < xs.length; i++) {
      expect(nth(xs, i, "x")).toBeLessThan(nth(xs, i - 1, "x"));
    }

    // offsetInLeaf round-trips for RTL too.
    for (let off = leaf.logStart; off <= leaf.logEnd; off++) {
      const x = caretInlineCoordInLeaf(leaf, off, measurer, view.axisMap);
      const localX = x - leaf.leaf.absoluteX;
      expect(offsetInLeaf(leaf, localX, measurer, view.axisMap)).toBe(off);
    }
  });

  it("caretInlineCoordInLeaf RTL endpoints: logStart at leaf right edge, logEnd at left edge", () => {
    const state = para("אבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const leaf = nth(view.logicalLeaves, 0, "leaf");

    const xStart = caretInlineCoordInLeaf(leaf, leaf.logStart, measurer, view.axisMap);
    const xEnd = caretInlineCoordInLeaf(leaf, leaf.logEnd, measurer, view.axisMap);
    expect(xStart).toBeCloseTo(leaf.leaf.absoluteX + leaf.leaf.width, 5);
    expect(xEnd).toBeCloseTo(leaf.leaf.absoluteX, 5);
  });

  it("inline-block leaf: caretInlineCoordInLeaf returns the two edges; offsetInLeaf maps by midpoint", () => {
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
    const positioned = positionTreeForTest(virtual);
    const measurer = adaptShaperToMeasurer(shaper);

    const lines = getLineIndex(positioned).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBe(1);
    const view = buildLineBidiView(nth(lines, 0, "line"));

    // The inline-block leaf owns one state unit; find it.
    const ib = view.logicalLeaves.find((l) => l.leaf.kind === "inline-block");
    expect(ib).toBeDefined();
    if (ib === undefined) return;
    expect(ib.logEnd - ib.logStart).toBe(1);

    // caretInlineCoordInLeaf: leading edge at logStart, trailing edge at logEnd.
    expect(caretInlineCoordInLeaf(ib, ib.logStart, measurer, view.axisMap)).toBeCloseTo(ib.leaf.absoluteX, 5);
    expect(caretInlineCoordInLeaf(ib, ib.logEnd, measurer, view.axisMap)).toBeCloseTo(
      ib.leaf.absoluteX + ib.leaf.width,
      5,
    );

    // offsetInLeaf: left half → logStart, right half → logEnd (midpoint split).
    expect(offsetInLeaf(ib, ib.leaf.width * 0.25, measurer, view.axisMap)).toBe(ib.logStart);
    expect(offsetInLeaf(ib, ib.leaf.width * 0.75, measurer, view.axisMap)).toBe(ib.logEnd);
  });
});

// ---------------------------------------------------------------------------
// selectionRectsForLineRange (P4-C.2.5 §F) — bidi-aware selection segmentation
// ---------------------------------------------------------------------------

describe("selectionRectsForLineRange", () => {
  it("pure-LTR range: ONE interval [startX, endX], xLo <= xHi", () => {
    const state = para("abc");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    // offsets 0..2 → x 0..16.
    const segs = selectionRectsForLineRange(view, 0, 2, measurer);
    expect(segs.length).toBe(1);
    expect(nth(segs, 0, "segs").xLo).toBe(0);
    expect(nth(segs, 0, "segs").xHi).toBe(16);
    expect(nth(segs, 0, "segs").level % 2).toBe(0);
  });

  it("uniform-RTL range: ONE interval with non-negative extent (endpoints swapped)", () => {
    // "אבג" RTL: caretX off0→24, off3→0. Range 0..3 → xLo=caretX(3)=0,
    // xHi=caretX(0)=24 (the logically-later offset 3 is the LOWER x).
    const state = para("אבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const segs = selectionRectsForLineRange(view, 0, 3, measurer);
    expect(segs.length).toBe(1);
    expect(nth(segs, 0, "segs").xLo).toBe(0);
    expect(nth(segs, 0, "segs").xHi).toBe(24);
    expect(nth(segs, 0, "segs").xHi).toBeGreaterThanOrEqual(nth(segs, 0, "segs").xLo);
    expect(nth(segs, 0, "segs").level % 2).toBe(1);
  });

  it("boundary-crossing range: TWO intervals, NOT coalesced across the direction boundary", () => {
    // "abcאבג": Latin [0,3) x0-24 LTR, Hebrew [3,6) x24-48 RTL. Range 2..5:
    //   Latin overlap [2,3) → LTR xLo=16, xHi=24 (level 0)
    //   Hebrew overlap [3,5) → RTL xLo=caretX(5)=32, xHi=caretX(3)=48 (level 1)
    // Latin xHi=24 ≠ Hebrew xLo=32 (not physically adjacent) AND different
    // level → two separate intervals.
    const state = para("abcאבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const segs = selectionRectsForLineRange(view, 2, 5, measurer);
    expect(segs.length).toBe(2);
    expect(nth(segs, 0, "segs").xLo).toBe(16);
    expect(nth(segs, 0, "segs").xHi).toBe(24);
    expect(nth(segs, 0, "segs").level % 2).toBe(0);
    expect(nth(segs, 1, "segs").xLo).toBe(32);
    expect(nth(segs, 1, "segs").xHi).toBe(48);
    expect(nth(segs, 1, "segs").level % 2).toBe(1);
    for (const s of segs) expect(s.xHi).toBeGreaterThanOrEqual(s.xLo);
  });

  it("within-RTL sub-range: endpoints swap (logically-later offset → lower x)", () => {
    // "abcאבג": range 4..6 inside the Hebrew RTL run. caretX off4→40, off6→24.
    // xLo=caretX(6)=24, xHi=caretX(4)=40.
    const state = para("abcאבג");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const segs = selectionRectsForLineRange(view, 4, 6, measurer);
    expect(segs.length).toBe(1);
    expect(nth(segs, 0, "segs").xLo).toBe(24);
    expect(nth(segs, 0, "segs").xHi).toBe(40);
  });

  it("same-parity adjacent runs coalesce into ONE interval", () => {
    // "ab" bold + "cd" — two LTR (level-0) runs that abut at x16. A range
    // covering both (0..4) coalesces into a single [0, 32] interval (same level,
    // physically adjacent).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab", { fontWeight: "bold" }), text("cd")]),
        }),
      ],
    });
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    for (const lv of view.logicalLeaves) expect(lv.level % 2).toBe(0);
    const segs = selectionRectsForLineRange(view, 0, 4, measurer);
    expect(segs.length).toBe(1);
    expect(nth(segs, 0, "segs").xLo).toBe(0);
    expect(nth(segs, 0, "segs").xHi).toBe(32);
  });

  it("empty range and strut line yield no intervals", () => {
    const state = para("abc");
    const { layout, measurer } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    expect(selectionRectsForLineRange(view, 2, 2, measurer)).toEqual([]);

    const empty = para("");
    const { layout: el, measurer: em } = pipeline(empty);
    const emptyView = buildLineBidiView(bodyLine(el));
    expect(emptyView.isEmpty).toBe(true);
    expect(selectionRectsForLineRange(emptyView, 0, 0, em)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// moveVisually (P4-C.2.3 §E) — ArrowLeft / ArrowRight visual-order caret motion
// ---------------------------------------------------------------------------

/**
 * A grapheme stepper over a plain block-relative state string (the test docs
 * are single-block, so block-relative offset === string index). Mirrors what
 * the production wiring builds from the block's inline content.
 */
function stepperFor(blockText: string): GraphemeStepper {
  return (offset, direction) =>
    direction === "forward"
      ? nextGraphemeBoundary(blockText, offset)
      : prevGraphemeBoundary(blockText, offset);
}

/** Pretty-print a result for trace-failure messages. */
function fmt(r: MoveVisuallyResult): string {
  return "exit" in r ? `exit:${r.exit}` : `${r.offset}/${r.caretAffinity}`;
}

describe("moveVisually", () => {
  it("pure-LTR ArrowRight = logical-forward (byte-identical to offset+1)", () => {
    const state = para("abc");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("abc");

    // From each interior offset, ArrowRight advances exactly one state unit.
    for (let off = 0; off < 3; off++) {
      const r = moveVisually(view, off, undefined, "right", step);
      expect("exit" in r).toBe(false);
      if (!("exit" in r)) expect(r.offset).toBe(off + 1);
    }
    // At the visual-right edge (logEnd) ArrowRight exits the line to the right.
    // On an LTR run the exit logical direction equals the physical direction.
    expect(moveVisually(view, 3, undefined, "right", step)).toEqual({
      exit: "right",
      exitLogicalDir: "forward",
    });
  });

  it("pure-LTR ArrowLeft = logical-backward (byte-identical to offset−1)", () => {
    const state = para("abc");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("abc");

    for (let off = 3; off > 0; off--) {
      const r = moveVisually(view, off, undefined, "left", step);
      expect("exit" in r).toBe(false);
      if (!("exit" in r)) expect(r.offset).toBe(off - 1);
    }
    expect(moveVisually(view, 0, undefined, "left", step)).toEqual({
      exit: "left",
      exitLogicalDir: "backward",
    });
  });

  it("uniform-RTL ArrowRight moves toward logical START (offset−1); exits at offset 0", () => {
    // "אבג" → a single odd-level (RTL) run [0,3). Visual-right = logical-backward.
    const state = para("אבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    expect(nth(view.logicalLeaves, 0, "logicalLeaves").level % 2).toBe(1);
    const step = stepperFor("אבג");

    // Full ArrowRight sequence from the logical END (visual-left edge):
    // 3 → 2 → 1 → 0 → exit-right.
    const seq: string[] = [];
    let off = 3;
    for (let i = 0; i < 5; i++) {
      const r = moveVisually(view, off, "after", "right", step);
      seq.push(fmt(r));
      if ("exit" in r) break;
      off = r.offset;
    }
    // Each press decrements the offset (toward logical start); offset 0 exits.
    expect(seq).toEqual(["2/after", "1/after", "0/after", "exit:right"]);
  });

  it("uniform-RTL ArrowLeft moves toward logical END (offset+1); exits at logEnd", () => {
    const state = para("אבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("אבג");

    const seq: string[] = [];
    let off = 0;
    for (let i = 0; i < 5; i++) {
      const r = moveVisually(view, off, "after", "left", step);
      seq.push(fmt(r));
      if ("exit" in r) break;
      off = r.offset;
    }
    // ArrowLeft in an RTL run is a FORWARD state step (toward logEnd), so the
    // in-run affinity is "before" — it keeps the caret on THIS RTL run at the
    // boundary it lands on (the run ENDING there), rather than flipping onto a
    // would-be next run. (#502: the prior parity-based "after" warped at the
    // visual-left edge.) Interior offsets are single-owner, so "before" is inert
    // there; it is load-bearing only at the run's logEnd boundary.
    expect(seq).toEqual(["1/before", "2/before", "3/before", "exit:left"]);
  });

  it("mixed LTR+RTL ArrowRight: full visual sequence incl. the dual-caret flip", () => {
    // "abcאבג" (LTR-base paragraph): Latin run [0,3) level 0, Hebrew run [3,6)
    // level 1. On-screen glyphs L→R: a b c ג ב א. visualLeaves = [latin, hebrew].
    //
    // TRACE of repeated ArrowRight from (0, undefined), derived step-by-step from
    // the ported algorithm AND cross-checked against the L→R glyph order:
    //   (0)        a|… caret left of a          → step fwd in LTR  → 1
    //   (1)        a|b                          → 2
    //   (2)        ab|c                         → 3 (latin logEnd = its visual-RIGHT edge)
    //   (3,before) abc| (right edge of latin)   → CROSS right into Hebrew run; its
    //              visual-LEFT edge is logEnd=6 (different parity ⇒ FLIP, same x)
    //              → 6,before
    //   (6,before) …|  (left edge of hebrew)    → step back in RTL → 5,after
    //   (5,after)  ג|ב                          → 4,after
    //   (4,after)  גב|א                          → 3,after (hebrew logStart = its
    //              visual-RIGHT edge)
    //   (3,after)  …גבא| (rightmost)            → CROSS right, no next run → exit-right
    const state = para("abcאבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("abcאבג");

    // Confirm the visual order assumption the trace depends on (latin left of
    // hebrew). If the engine ever reorders differently this guards the trace.
    expect(view.visualLeaves.length).toBe(2);
    expect(nth(view.visualLeaves, 0, "visualLeaves").level % 2).toBe(0); // latin (LTR) leftmost
    expect(nth(view.visualLeaves, 1, "visualLeaves").level % 2).toBe(1); // hebrew (RTL) to its right
    expect(nth(view.visualLeaves, 0, "visualLeaves").logStart).toBe(0);
    expect(nth(view.visualLeaves, 1, "visualLeaves").logStart).toBe(3);

    const seq: string[] = [];
    let off = 0;
    let aff: "before" | "after" | undefined = undefined;
    for (let i = 0; i < 9; i++) {
      const r = moveVisually(view, off, aff, "right", step);
      seq.push(fmt(r));
      if ("exit" in r) break;
      off = r.offset;
      aff = r.caretAffinity;
    }
    expect(seq).toEqual([
      "1/before", // within latin
      "2/before",
      "3/before", // latin right edge
      "6/before", // FLIP into hebrew (visual-left edge = logEnd) — same x, dual caret
      "5/after", // within hebrew, moving visual-right = logical-backward
      "4/after",
      "3/after", // hebrew right edge (logStart)
      "exit:right",
    ]);
  });

  it("mixed LTR+RTL ArrowLeft from the end mirrors ArrowRight", () => {
    // From (6, after) — the logical END (rightmost in the RTL run is the LEFTMOST
    // glyph 'א' at logEnd... the caret at offset 6 sits at the hebrew run's
    // visual-LEFT edge). Pressing ArrowLeft walks visual-left across the glyphs.
    // We assert the WITHIN-run + boundary steps we are confident in.
    const state = para("abcאבג");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("abcאבג");

    // Start at the visual-left end of the line: offset 6 is the hebrew run's
    // logEnd, which renders at its visual-LEFT edge (leftmost of the RTL run).
    // ArrowLeft from there crosses LEFT into… nothing further left than latin's
    // right edge — but offset 6 is to the RIGHT of latin visually, so the first
    // ArrowLeft stays/crosses per the algorithm. Assert the confident steps:
    //   (3,after)  hebrew visual-RIGHT edge (rightmost) → ArrowLeft = logical-fwd
    //              in RTL → 4,after
    const r1 = moveVisually(view, 3, "after", "left", step);
    // ArrowLeft in the RTL run is a FORWARD state step (toward logEnd), so the
    // in-run affinity is "before" (#502 fix; inert here at the interior offset 4).
    expect(fmt(r1)).toBe("4/before"); // within hebrew, visual-left = logical-forward

    // Within latin, ArrowLeft = logical-backward (LTR). A BACKWARD step heads
    // toward logStart, so the in-run affinity is "after" — it keeps the caret on
    // THIS LTR run (the run STARTING at the boundary it lands on) rather than
    // flipping onto a would-be previous run. (#502; inert here at interior off 1.)
    const r2 = moveVisually(view, 2, "before", "left", step);
    expect(fmt(r2)).toBe("1/after");

    // At latin's visual-LEFT edge (logStart 0) ArrowLeft exits left. The edge run
    // is LTR, so the exit logical direction is backward (== the physical arrow).
    expect(moveVisually(view, 0, "after", "left", step)).toEqual({
      exit: "left",
      exitLogicalDir: "backward",
    });

    // Boundary FLIP going visual-left: from the hebrew run's visual-LEFT edge
    // (offset 6) ArrowLeft crosses left into latin. TODO(C.2.7 browser-confirm):
    // the exact entered offset/affinity at this left-going boundary flip is
    // asserted here from the ported algorithm; confirm against Google Docs.
    const flip = moveVisually(view, 6, "before", "left", step);
    expect(fmt(flip)).toBe("3/before"); // enters latin at its visual-right edge (logEnd)
  });

  it("same-parity boundary (two adjacent LTR runs) advances with NO flip", () => {
    // "ab" bold + "cd" — two LTR runs split by an attr change, same level parity.
    // ArrowRight across the run boundary must ADVANCE one unit, never produce a
    // same-offset affinity flip.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab", { fontWeight: "bold" }),
            text("cd"),
          ]),
        }),
      ],
    });
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    const step = stepperFor("abcd");

    // Both runs are LTR (even level), so this is a same-parity boundary at off 2.
    for (const lv of view.logicalLeaves) expect(lv.level % 2).toBe(0);

    // ArrowRight at the boundary (offset 2) advances to 3 — NOT a 2/2 flip.
    const r = moveVisually(view, 2, "before", "right", step);
    expect("exit" in r).toBe(false);
    if (!("exit" in r)) {
      expect(r.offset).toBe(3);
      expect(r.offset).not.toBe(2); // crucial: no spurious same-offset flip
    }
  });

  it("empty (strut-only) line exits in the press direction", () => {
    const state = para("");
    const { layout } = pipeline(state);
    const view = buildLineBidiView(bodyLine(layout));
    expect(view.isEmpty).toBe(true);
    const step = stepperFor("");
    // LTR-base strut line: exit logical direction equals the physical direction.
    expect(moveVisually(view, 0, undefined, "right", step)).toEqual({
      exit: "right",
      exitLogicalDir: "forward",
    });
    expect(moveVisually(view, 0, undefined, "left", step)).toEqual({
      exit: "left",
      exitLogicalDir: "backward",
    });
  });
});
