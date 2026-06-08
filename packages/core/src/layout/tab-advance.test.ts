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
import { buildBlock, buildState, inlineContent, text, embed } from "../test-utils/state-builders";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { cascadePass } from "../cascade";
import { layoutTree } from "./dispatch";
import { layoutBlock } from "./bfc";
import { makeRootContext } from "./layout-context";
import { resolvePositionedTree } from "./positioned-tree";
import { createMockShaper } from "./mock-shaper";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { TabStop } from "../styles";
import type { LayoutBox, InlineBlockBox } from "./layout-box";
import type { PageConfig } from "./page-config";
import { resolvePixelPosition } from "../cursor/cursor-position";
import { createPosition } from "../state";
import type { BlockId, State } from "../state";

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
  return resolvePositionedTree(laid);
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
      const result = layoutBlock(root, 0, 0, ctx, shaper);
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
