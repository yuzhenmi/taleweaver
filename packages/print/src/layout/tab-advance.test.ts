/**
 * Tab stops S2 — IFC tab inline-unit RECOGNITION.
 *
 * A tab is modelled as the existing `"tab"` inline EMBED. The render layer emits
 * it via its generic embed fallback as an `inline-block` ElementBox (inlineSize 0)
 * carrying `metadata.embedType === "tab"`. S2 makes the IFC RECOGNIZE that
 * inline-block as a tab unit: it sets `isTab` on the token + wrap-unit and stamps
 * a typed `inlineMeta: { embedType: "tab", leader }` onto the emitted
 * `InlineBlockBox`. S2 adds NO advance logic — a recognized tab is still a
 * zero-advance inline-block; the destination-stop advance + real leader land in
 * later slices.
 *
 * The load-bearing assertions:
 *   1. structural — the tab lays out as an `inline-block` LEAF on the line (it is
 *      NOT dropped or collapsed into a space); the line's offset span covers it.
 *   2. recognition (would FAIL without S2's wiring) — that inline-block box
 *      carries `inlineMeta.embedType === "tab"` (and the S2 placeholder
 *      `leader === "none"`).
 */
import { describe, it, expect } from "vitest";
import { buildBlock, buildState, inlineContent, text, embed } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { layoutBlock } from "./bfc";
import { layoutInlineContent } from "./ifc";
import { makeRootContext } from "./layout-context";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { Style, TabStop } from "@taleweaver/core";
import type { Direction } from "@taleweaver/core";
import type { LayoutBox, InlineBlockBox, LineBox, TextRunBox } from "./layout-box";
import type { PageConfig } from "./page-config";
import { resolvePixelPosition } from "../cursor/cursor-position";
import { createPosition } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { RenderNode } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const shaper = createMockShaper(8, 16);

const pageConfig: PageConfig = {
  pageInlineSize: 500,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/**
 * Doc = document → paragraph with inlineContent [text("a"), embed("tab"), trailing].
 * `tabStops` is carried as a paragraph block-attr → cascade resolves it onto the
 * paragraph's ComputedStyle, which the IFC reads to resolve the tab's advance.
 *
 * `trailing` is the text AFTER the tab (the post-tab segment). Defaults to "b"
 * (the S2/S3 single-char fixture); right/center alignment (S5) needs a
 * multi-char segment (e.g. "bb") so the look-ahead has a non-trivial width.
 */
function tabDoc(tabStops: readonly TabStop[] = [], trailing = "b"): State {
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
        attrs: { tabStops },
        inlineContent: inlineContent([text("a"), embed("tab"), text(trailing)]),
      }),
    ],
  });
}

/** Lay the doc out through the real render→layout pipeline; materialize the tree. */
function layoutTabDoc(tabStops: readonly TabStop[] = [], trailing = "b"): LayoutBox {
  const state = tabDoc(tabStops, trailing);
  const renderOutput = render(state, componentRegistry, attrRegistry);
  const laid = layoutTree(renderOutput.root, pageConfig.pageInlineSize, shaper, pageConfig);
  return positionTreeForTest(laid);
}

/**
 * Caret x of `position(blockId, offset)` against a positioned layout, mirroring
 * the `overflow-wrap-caret.test.ts` pipeline. Returns the resolved x or `NaN` if
 * the position fails to resolve (so the assertion fails loudly rather than
 * silently passing on `null`).
 */
function caretX(state: State, blockId: string, offset: number, layout: LayoutBox): number {
  const r = resolvePixelPosition(state, createPosition(blockId as BlockId, offset), layout, shaper);
  return r === null ? Number.NaN : r.x;
}

/** Collect every box of a given type in document order. */
function collectByType(box: LayoutBox, type: LayoutBox["type"]): LayoutBox[] {
  const out: LayoutBox[] = [];
  function walk(b: LayoutBox): void {
    if (b.type === type) out.push(b);
    if ("children" in b) {
      for (const c of b.children as readonly LayoutBox[]) walk(c);
    }
  }
  walk(box);
  return out;
}

describe("tab-stops S2 — IFC recognizes the tab inline-block", () => {
  const tree = layoutTabDoc();

  it("lays the tab out as an inline-block LEAF (not dropped/collapsed)", () => {
    const inlineBlocks = collectByType(tree, "inline-block");
    expect(inlineBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the surrounding text runs (a and b) on the line around the tab", () => {
    const runText = collectByType(tree, "text-run")
      .map((b) => (b.type === "text-run" ? b.text : ""))
      .join("");
    // The tab does not swallow or split its neighbours: both letters survive.
    expect(runText).toContain("a");
    expect(runText).toContain("b");
  });

  it("the line's offset span covers the tab (3 source units: a, tab, b)", () => {
    const lines = collectByType(tree, "line").filter(
      (b): b is Extract<LayoutBox, { type: "line" }> => b.type === "line",
    );
    // The single content line owns all three state-model units (a + tab + b).
    const spanningLine = lines.find(
      (l) => l.inlineOffsetEnd - l.inlineOffsetStart >= 3,
    );
    expect(spanningLine).toBeDefined();
  });

  it("stamps inlineMeta { embedType: 'tab', leader: 'none' } on the tab box (S2 recognition)", () => {
    const inlineBlocks = collectByType(tree, "inline-block").filter(
      (b): b is InlineBlockBox => b.type === "inline-block",
    );
    const tabBox = inlineBlocks.find((b) => b.inlineMeta?.embedType === "tab");
    expect(tabBox).toBeDefined();
    expect(tabBox?.inlineMeta?.leader).toBe("none");
  });
});

describe("tab-stops S3 — IFC left/default-grid advance", () => {
  it("left/default-grid tab advances to the next 48px multiple", () => {
    // No explicit stops → default grid 48. pen after "a" = 8 → nextStop(8) = 48
    // → advance = 40 → "b" starts at x=48. Caret offset 2 (just after the tab,
    // before "b") sits at the resolved stop x=48.
    const state = tabDoc();
    const layout = layoutTabDoc();
    expect(caretX(state, "p", 2, layout)).toBe(48);
  });

  it("explicit left stop overrides the default grid", () => {
    // pen after "a" = 8; the only explicit stop is at 100 (> 8) → nextStop = 100
    // → "b" starts at the stop x=100.
    const stops: readonly TabStop[] = [{ position: 100, alignment: "left", leader: "none" }];
    const state = tabDoc(stops);
    const layout = layoutTabDoc(stops);
    expect(caretX(state, "p", 2, layout)).toBe(100);
  });

  it("a default-grid tab carries leader 'none'; an explicit-stop tab carries its leader", () => {
    // Default grid → no stop, leader "none".
    const defaultTree = layoutTabDoc();
    const defaultTab = collectByType(defaultTree, "inline-block")
      .filter((b): b is InlineBlockBox => b.type === "inline-block")
      .find((b) => b.inlineMeta?.embedType === "tab");
    expect(defaultTab?.inlineMeta?.leader).toBe("none");

    // Explicit stop with a dot leader → the destination stop's leader is stamped.
    const stops: readonly TabStop[] = [{ position: 100, alignment: "left", leader: "dot" }];
    const dotTree = layoutTabDoc(stops);
    const dotTab = collectByType(dotTree, "inline-block")
      .filter((b): b is InlineBlockBox => b.type === "inline-block")
      .find((b) => b.inlineMeta?.embedType === "tab");
    expect(dotTab?.inlineMeta?.leader).toBe("dot");
  });

  it("invalidates the IFC cache when tabStops change with identical content (S1 cache-gate regression)", () => {
    // LOAD-BEARING: share ONE LayoutContext (hence one ifcStateCache) across two
    // layoutBlock calls. The IFC keys its cache by `parent.key` ("p"), which is
    // identical across both render trees — so the second call would HIT the cached
    // lines from the first if the `hasTab` bypass + tabStops gate didn't force a
    // miss. The inline tokens are byte-identical (same "a"+tab+"b"); only the
    // tabStops style differs (100 → 200). Without invalidation, "b" would stay at
    // x=100; with it, it re-flows to x=200.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);

    const layoutWithStop = (pos: number): { state: State; layout: LayoutBox } => {
      const stops: readonly TabStop[] = [{ position: pos, alignment: "left", leader: "none" }];
      const state = tabDoc(stops);
      const root = cascadePass(render(state, componentRegistry, attrRegistry).root);
      if (root.type !== "element") throw new Error("expected element root");
      const result = layoutBlock(root, 0, 0, ctx, shaper, undefined);
      if (result.box === null) throw new Error("layoutBlock returned null");
      return { state, layout: result.box };
    };

    const first = layoutWithStop(100);
    expect(caretX(first.state, "p", 2, first.layout)).toBe(100);

    // Re-layout the SAME paragraph key with a different stop on the SAME ctx/cache.
    const second = layoutWithStop(200);
    expect(caretX(second.state, "p", 2, second.layout)).toBe(200);
  });
});

describe("tab-stops S5 — right/center alignment via bounded segment look-ahead", () => {
  it("right tab: the segment after the tab ends at the stop", () => {
    // "a"(8) + tab(right@100) + "bb"(16). Post-tab segment width w=16 → tab
    // advance = max(0, min(100 − 16 − 8, ...)) = 76 → "bb" runs 84..100, ending
    // exactly on the stop.
    const stops: readonly TabStop[] = [{ position: 100, alignment: "right", leader: "none" }];
    const state = tabDoc(stops, "bb");
    const layout = layoutTabDoc(stops, "bb");
    expect(caretX(state, "p", 2, layout)).toBe(84); // "bb" starts at 84
    expect(caretX(state, "p", 4, layout)).toBe(100); // "bb" ends at the stop
  });

  it("center tab: the segment is centered on the stop", () => {
    // "a"(8) + tab(center@100) + "bb"(16). advance = max(0, 100 − 16/2 − 8) = 84
    // → "bb" runs 92..108, centered on the stop (100).
    const stops: readonly TabStop[] = [{ position: 100, alignment: "center", leader: "none" }];
    const state = tabDoc(stops, "bb");
    const layout = layoutTabDoc(stops, "bb");
    expect(caretX(state, "p", 2, layout)).toBe(92); // "bb" starts at 92
    expect(caretX(state, "p", 4, layout)).toBe(108); // "bb" ends at 108 (centered on 100)
  });

  it("right tab overflow falls back to left (advance 0)", () => {
    // Stop must be > pen so nextStop returns it (not the default grid), but with
    // S − w − pen < 0: S=20, pen=8, w=16 → 20 − 16 − 8 = −4 → max(0, …) = 0.
    // The tab makes no backward move; "bb" starts at the current pen (x=8).
    const stops: readonly TabStop[] = [{ position: 20, alignment: "right", leader: "none" }];
    const state = tabDoc(stops, "bb");
    const layout = layoutTabDoc(stops, "bb");
    expect(caretX(state, "p", 2, layout)).toBe(8); // "bb" starts at the pen, no backward move
  });
});

describe("tab-stops S6 — decimal alignment (first '.' on the stop; right fallback)", () => {
  it("decimal tab aligns the first '.' on the stop", () => {
    // "a"(8) + tab(decimal@100) + "12.5". The '.' is the 3rd char of the segment,
    // so dOff = width of "12" = 16. advance = max(0, 100 − 16 − 8) = 76 → the
    // segment starts at 84, and the '.' sits at 84 + 16 = 100. The caret offset
    // just BEFORE the '.' (segment offset 4 = before "."; "12.5" offsets:
    // 2=before"1", 3=before"2", 4=before".", 5=before"5", 6=after"5") = x 100.
    const stops: readonly TabStop[] = [{ position: 100, alignment: "decimal", leader: "none" }];
    const state = tabDoc(stops, "12.5");
    const layout = layoutTabDoc(stops, "12.5");
    expect(caretX(state, "p", 2, layout)).toBe(84); // segment starts at 84
    expect(caretX(state, "p", 4, layout)).toBe(100); // caret before the '.' = the stop
  });

  it("decimal tab with no separator falls back to right alignment", () => {
    // "bb" has no '.', so decimal → right: the segment ENDS at the stop.
    // "bb"(16) → advance = max(0, 100 − 16 − 8) = 76 → "bb" runs 84..100.
    const stops: readonly TabStop[] = [{ position: 100, alignment: "decimal", leader: "none" }];
    const state = tabDoc(stops, "bb");
    const layout = layoutTabDoc(stops, "bb");
    expect(caretX(state, "p", 4, layout)).toBe(100); // "bb" ends at the stop (right fallback)
  });
});

describe("tab-stops — content-edge alignment (right-aligns the segment to the line's content edge)", () => {
  // A content-edge tab is the TOC primitive: "Heading"<tab>"12" places "12"
  // flush to the line's content edge (the right margin). The stop is synthesized
  // with `position: 0` (so it sorts first in the ascending tabStops array), but
  // its EFFECTIVE destination is the line's content width.
  //
  // Mock shaper CHAR_W = 8. pageInlineSize = 500 (zero margins) → content edge
  // W = 500. Layout: "Heading"(7 chars → 56) + tab(content-edge) + "12"(16).
  // The post-tab segment ("12") right edge must land at W=500 → "12" runs
  // 484..500. The tab's destination is the content edge regardless of stored
  // position, and the synthesized dot leader rides through.
  const stops: readonly TabStop[] = [
    { position: 0, alignment: "content-edge", leader: "dot" },
  ];

  function contentEdgeDoc(): { state: State; layout: LayoutBox } {
    const state = buildState({
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
          attrs: { tabStops: stops },
          inlineContent: inlineContent([text("Heading"), embed("tab"), text("12")]),
        }),
      ],
    });
    const renderOutput = render(state, componentRegistry, attrRegistry);
    const laid = layoutTree(renderOutput.root, pageConfig.pageInlineSize, shaper, pageConfig);
    return { state, layout: positionTreeForTest(laid) };
  }

  it("places the post-tab segment ('12') flush to the line's content edge", () => {
    const { state, layout } = contentEdgeDoc();
    // "Heading" = offset 0..7, tab = offset 7..8, "12" = offset 8..10.
    // The caret just before "12" (offset 8) sits at the segment start; the caret
    // after "12" (offset 10) sits at the content edge W=500.
    // "12" width = 16 → starts at 500 − 16 = 484.
    expect(caretX(state, "p", 8, layout)).toBe(484); // "12" starts at 484
    expect(caretX(state, "p", 10, layout)).toBe(500); // "12" ends at the content edge
  });

  it("stamps the content-edge stop's leader ('dot') onto the resolved tab box", () => {
    const { layout } = contentEdgeDoc();
    const tabBox = collectByType(layout, "inline-block")
      .filter((b): b is InlineBlockBox => b.type === "inline-block")
      .find((b) => b.inlineMeta?.embedType === "tab");
    expect(tabBox).toBeDefined();
    expect(tabBox?.inlineMeta?.leader).toBe("dot");
  });
});

// ---------------------------------------------------------------------------
// S8 — justify suppression + RTL logical-inline advance
// ---------------------------------------------------------------------------

/**
 * Lay out a single paragraph from explicit render children (text runs + a tab
 * inline-block embed) through the IFC, mirroring `ifc-align.test.ts`'s
 * `layoutPara` but allowing an embedded `metadata.embedType === "tab"`
 * inline-block — which `tabDoc` cannot express through the state-builders' plain
 * `embed("tab")` when we also need to control the container width and the inline
 * base `direction` precisely.
 *
 * The tab embed is emitted exactly as the render layer emits it (an
 * `inline-block` ElementBox with `metadata.embedType: "tab"` and `inlineSize: 0`)
 * so the IFC's recognition + advance path runs unchanged.
 */
function tabRun(key: string, content: string): RenderNode {
  return createTextBox(key, {}, content);
}

function tabEmbed(key: string): RenderNode {
  return createElementBox(
    key,
    { display: "inline-block", inlineSize: 0 },
    [],
    { embedType: "tab" },
  );
}

function layoutParaWithChildren(
  children: readonly RenderNode[],
  width: number,
  style: Style,
  direction: Direction = "ltr",
): LineBox[] {
  const tree = cascadePass(createElementBox("p", { display: "block", ...style }, children));
  if (tree.type !== "element") throw new Error("expected element");
  const baseCtx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  // The IFC reads the inline base direction from `ctx.direction`; override for
  // the RTL case (makeRootContext derives it from the root computed style).
  const ctx = direction === baseCtx.direction ? baseCtx : { ...baseCtx, direction };
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");
  return result.box.children.filter((c): c is LineBox => c.type === "line");
}

/** Text-run children of a line (visible glyph runs), in inline order. */
function lineTextRuns(line: LineBox): TextRunBox[] {
  return line.children.filter((c): c is TextRunBox => c.type === "text-run");
}

/** The single inline-block tab box on a line (its physical x + frozen width). */
function lineTabBox(line: LineBox): InlineBlockBox {
  const tab = line.children.find(
    (c): c is InlineBlockBox => c.type === "inline-block" && c.inlineMeta?.embedType === "tab",
  );
  if (tab === undefined) throw new Error("expected a tab inline-block on the line");
  return tab;
}

describe("tab-stops S8 — justify is suppressed on a line containing a tab", () => {
  // Mock shaper CHAR_W = 8, default tab interval 48.
  // Children: "a"(8) + tab(default-grid → 48, advance 40) + "bb cc"(40) + "dddd"(32).
  // W = 100 makes the FIRST line wrap BEFORE "dddd":
  //   pen: a→8, tab→48, "bb"→64, " "→72, "cc"→88  (≤ 100, fits)
  //        + "dddd" → 120 > 100 ⇒ wraps. So line 0 = "a<tab>bb cc " (NON-LAST,
  //   the only line justify would fire on); line 1 = "dddd" (last, never justified).
  const W = 100;
  const CHILDREN = [
    tabRun("t0", "a"),
    tabEmbed("tab"),
    tabRun("t1", "bb cc dddd"),
  ];

  it("keeps the interior inter-word space at its NATURAL width (no stretch) on a tabbed line", () => {
    const lines = layoutParaWithChildren(CHILDREN, W, {
      textAlign: "justify",
      whiteSpace: "normal",
    });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const runs = lineTextRuns(nth(lines, 0, "line"));
    // The interior space between "bb" and "cc" is a standalone run only if
    // justify split it; suppressed justify leaves "bb cc " merged with the space
    // at its NATURAL 8px. Assert via geometry: "cc" sits immediately after the
    // natural-width space, i.e. NOT shifted right by any justify gap.
    // "bb" starts at the tab stop (48); "bb"=16 → 48..64; natural space 64..72;
    // "cc" → 72..88. A stretched space would push "cc" past 72.
    const cc = runs.find((r) => r.text.includes("cc"));
    if (cc === undefined) throw new Error("expected a 'cc' run on line 0");
    expect(nth(lines, 0, "line").x + cc.x).toBe(72);
  });

  it("CONTROL: the SAME justified line WITHOUT a tab DOES stretch its interior space", () => {
    // Drop the tab: "aaaaaa"(48) + "bb cc dddd". Same W=100, same wrap point
    // before "dddd" (pen: "aaaaaa"→48, "bb"→64, " "→72, "cc"→88; +dddd overflows).
    // Line 0 = "aaaaaa bb cc " is NON-LAST ⇒ justify fires ⇒ interior spaces
    // widen, pushing "cc" RIGHT of its natural x (72). This proves the gate (not
    // a broken justify) is what suppresses stretching in the tabbed case.
    const lines = layoutParaWithChildren(
      [tabRun("t0", "aaaaaa"), tabRun("t1", "bb cc dddd")],
      W,
      { textAlign: "justify", whiteSpace: "normal" },
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const runs = lineTextRuns(nth(lines, 0, "line"));
    const cc = runs.find((r) => r.text === "cc");
    if (cc === undefined) throw new Error("expected a standalone 'cc' run on line 0");
    expect(nth(lines, 0, "line").x + cc.x).toBeGreaterThan(72); // shifted right by the justify gap
  });
});

describe("tab-stops S8 — RTL tab advance is logical-inline (test-lock)", () => {
  // INVARIANT lock (robust, no brittle exact-pixel mirror): lay out the SAME
  // "a"<tab>"b" doc LTR and RTL with the SAME explicit left stop and assert the
  // two LOGICAL-INLINE invariants that prove the tab advance is computed from
  // the logical pen and projected to physical by the writing-mode axisMap —
  // NOT computed/applied in physical x:
  //
  //   (1) The tab box's LOGICAL advance (its frozen `inlineSize`/width) is
  //       IDENTICAL across directions (92px either way). The advance magnitude
  //       depends only on the logical pen + the logical stop position, so it is
  //       direction-independent. A physical-coord implementation would compute a
  //       DIFFERENT advance under RTL (mirrored stop), so identical advance ⇒
  //       logical-inline.
  //
  //   (2) The post-tab "b" stays in LOGICAL order after the tab (b = a + 8 + 92
  //       = a + 100) in BOTH directions — the run "a tab b" is all-LTR content,
  //       so bidi keeps its visual order intact; and the WHOLE logical run is
  //       mirrored to the inline-END under RTL: in LTR the content sits at the
  //       inline-START (a.x = 0); in RTL the axisMap pushes it to the inline-END
  //       (a.x = lineWidth − contentWidth = 300 − 108 = 192 > 0). That nonzero
  //       RTL offset is the mirror signature — the advance rode logical→physical
  //       projection, it was not re-derived in physical space.
  const W = 300;
  const STOP: readonly TabStop[] = [{ position: 100, alignment: "left", leader: "none" }];
  const CHILDREN = [tabRun("t0", "a"), tabEmbed("tab"), tabRun("t1", "b")];

  function paContent(direction: Direction): {
    tab: InlineBlockBox;
    aRun: TextRunBox;
    bRun: TextRunBox;
  } {
    const lines = layoutParaWithChildren(CHILDREN, W, { tabStops: STOP }, direction);
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line");
    const runs = lineTextRuns(line);
    const aRun = runs.find((r) => r.text === "a");
    const bRun = runs.find((r) => r.text === "b");
    if (aRun === undefined || bRun === undefined) {
      throw new Error("expected both 'a' and 'b' runs on the line");
    }
    return { tab: lineTabBox(line), aRun, bRun };
  }

  it("LTR: content sits at the inline-start; 'b' is one tab advance (92) past 'a'", () => {
    const { tab, aRun, bRun } = paContent("ltr");
    // pen after "a" = 8 → left stop 100 → logical advance = 92.
    expect(tab.inlineSize).toBe(92);
    expect(aRun.x).toBe(0); // content at the inline-START (physical left).
    // "a"(0..8) + tab(8..100) → "b" one full advance past "a": 0 + 8 + 92 = 100.
    expect(bRun.x).toBe(aRun.x + 8 + tab.inlineSize);
  });

  it("RTL: the tab's LOGICAL advance is IDENTICAL; the whole run mirrors to the inline-end", () => {
    const ltr = paContent("ltr");
    const rtl = paContent("rtl");
    // (1) advance magnitude is direction-independent (logical-inline).
    expect(rtl.tab.inlineSize).toBe(ltr.tab.inlineSize); // 92 either way
    // (2a) intra-run logical order preserved: "b" is still one advance past "a"
    // (the same +100 relationship as LTR) — the advance is applied in logical
    // coords, not flipped per-glyph.
    expect(rtl.bRun.x).toBe(rtl.aRun.x + 8 + rtl.tab.inlineSize);
    // (2b) MIRROR signature: the content block is pushed to the inline-END under
    // RTL (a.x = lineWidth − contentWidth), whereas LTR pins it at 0. content
    // width = "a"(8) + tab(92) + "b"(8) = 108 → RTL a.x = 300 − 108 = 192.
    expect(ltr.aRun.x).toBe(0);
    expect(rtl.aRun.x).toBe(W - (8 + rtl.tab.inlineSize + 8)); // 192
  });
});
