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
import { layoutTree } from "./dispatch";
import { resolvePositionedTree } from "./positioned-tree";
import { createMockShaper } from "./mock-shaper";
import type { LayoutBox, InlineBlockBox } from "./layout-box";
import type { PageConfig } from "./page-config";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const shaper = createMockShaper(8, 16);

const pageConfig: PageConfig = {
  pageInlineSize: 500,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/** Doc = document → paragraph with inlineContent [text("a"), embed("tab"), text("b")]. */
function tabDoc(): ReturnType<typeof buildState> {
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
        inlineContent: inlineContent([text("a"), embed("tab"), text("b")]),
      }),
    ],
  });
}

/** Lay the doc out through the real render→layout pipeline; materialize the tree. */
function layoutTabDoc(): LayoutBox {
  const state = tabDoc();
  const renderOutput = render(state, componentRegistry, attrRegistry);
  const laid = layoutTree(renderOutput.root, pageConfig.pageInlineSize, shaper, pageConfig);
  return resolvePositionedTree(laid);
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
