/**
 * P1.C.1b: `section` layout-transparency guard, driven through the REAL
 * pipeline (state → render → cascade → layout) rather than a hand-built
 * RenderNode tree.
 *
 * A `section` computes `display: contents`, so a document containing a
 * section must lay out byte-identically to the same document with the
 * section's children spliced into the document root. This exercises
 * `sectionComponent.render` for real and confirms C.1a's `flattenContents`
 * makes the section invisible to the BFC/IFC/paginator.
 */
import { describe, it, expect } from "vitest";
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { State } from "@taleweaver/core";

const shaper = createMockShaper(8, 16);
const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
// Wide page so the small doc never paginates: layoutTree returns a LayoutBox,
// not a VirtualLayoutTree, so the two trees compare directly via toEqual.
const W = 800;

// doc root children: [p_one, section([p_alpha, p_beta]), p_two]
function sectionedDoc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p_one",
        lastChildId: "p_two",
      }),
      buildBlock({
        id: "p_one",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "sec",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "sec",
        type: "section",
        parentId: "doc",
        prevSiblingId: "p_one",
        nextSiblingId: "p_two",
        firstChildId: "p_alpha",
        lastChildId: "p_beta",
      }),
      buildBlock({
        id: "p_alpha",
        type: "paragraph",
        parentId: "sec",
        nextSiblingId: "p_beta",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "p_beta",
        type: "paragraph",
        parentId: "sec",
        prevSiblingId: "p_alpha",
        inlineContent: inlineContent([text("beta")]),
      }),
      buildBlock({
        id: "p_two",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "sec",
        inlineContent: inlineContent([text("two")]),
      }),
    ],
  });
}

// doc root children: [p_one, p_alpha, p_beta, p_two] (section's children hoisted)
function hoistedDoc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p_one",
        lastChildId: "p_two",
      }),
      buildBlock({
        id: "p_one",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p_alpha",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "p_alpha",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p_one",
        nextSiblingId: "p_beta",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "p_beta",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p_alpha",
        nextSiblingId: "p_two",
        inlineContent: inlineContent([text("beta")]),
      }),
      buildBlock({
        id: "p_two",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p_beta",
        inlineContent: inlineContent([text("two")]),
      }),
    ],
  });
}

function layoutOf(state: State): LayoutBox {
  const renderOutput = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadePass(renderOutput.root);
  const tree = layoutTree(cascaded, W, shaper);
  if (tree.type === "virtual-root") {
    throw new Error(
      "expected a non-paginated LayoutBox at width 800 — small doc should not paginate",
    );
  }
  return tree;
}

function anyBoxHasKey(box: LayoutBox, key: string): boolean {
  if (box.key === key) return true;
  if ("children" in box) {
    for (const child of box.children as readonly LayoutBox[]) {
      if (anyBoxHasKey(child, key)) return true;
    }
  }
  return false;
}

describe("section layout transparency (P1.C.1b)", () => {
  it("a section lays out byte-identically to its children spliced into the parent", () => {
    const withSection = layoutOf(sectionedDoc());
    const hoisted = layoutOf(hoistedDoc());
    expect(withSection).toEqual(hoisted);
  });

  it("the section block's id appears in NO layout box (display: contents = no box)", () => {
    const withSection = layoutOf(sectionedDoc());
    expect(anyBoxHasKey(withSection, "sec")).toBe(false);
    // Sanity: the section's children DO appear.
    expect(anyBoxHasKey(withSection, "p_alpha")).toBe(true);
    expect(anyBoxHasKey(withSection, "p_beta")).toBe(true);
  });
});
