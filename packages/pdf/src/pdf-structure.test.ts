// packages/pdf/src/pdf-structure.test.ts
//
// #526 (T4) — `mapAccessibilityTree`: pure mapping from the core
// `AccessibilityNode` projection to the pdf-package-local `PdfStructureNode`
// structure model (a tree of PDF standard structure-element roles). Asserts the
// role map, the alt-text carry for figures, the DROP set (banner/contentinfo/
// separator/decorative-image → no node), and that a dropped container's ENTIRE
// subtree is excluded (running header/footer content is /Artifact, carries no
// MCID — a surfaced child would be a dangling empty-/K structure node).

import { describe, it, expect } from "vitest";
import { asBlockId, type AccessibilityNode } from "@taleweaver/core";
import { mapAccessibilityTree, type PdfStructureNode } from "./pdf-structure";

function nonNull<T>(v: T | null, what = "value"): T {
  if (v === null) throw new Error(`expected ${what} to be non-null`);
  return v;
}

/** Build an AccessibilityNode literal with sensible defaults. */
function node(partial: Partial<AccessibilityNode> & Pick<AccessibilityNode, "role">): AccessibilityNode {
  return {
    sourceBlockId: null,
    children: [],
    ...partial,
  };
}

describe("mapAccessibilityTree", () => {
  it("maps the structural roles to PDF standard structure types", () => {
    expect(nonNull(mapAccessibilityTree(node({ role: "document" }))).role).toBe("Document");
    expect(nonNull(mapAccessibilityTree(node({ role: "paragraph" }))).role).toBe("P");
    expect(nonNull(mapAccessibilityTree(node({ role: "list" }))).role).toBe("L");
    expect(nonNull(mapAccessibilityTree(node({ role: "listitem" }))).role).toBe("LI");
    expect(nonNull(mapAccessibilityTree(node({ role: "table" }))).role).toBe("Table");
    expect(nonNull(mapAccessibilityTree(node({ role: "row" }))).role).toBe("TR");
    expect(nonNull(mapAccessibilityTree(node({ role: "cell" }))).role).toBe("TD");
    expect(nonNull(mapAccessibilityTree(node({ role: "columnheader" }))).role).toBe("TH");
    expect(nonNull(mapAccessibilityTree(node({ role: "doc-footnote" }))).role).toBe("Note");
    expect(nonNull(mapAccessibilityTree(node({ role: "navigation" }))).role).toBe("TOC");
  });

  it("maps heading level to H1..H6, clamped to 1..6", () => {
    expect(nonNull(mapAccessibilityTree(node({ role: "heading", level: 2 }))).role).toBe("H2");
    expect(nonNull(mapAccessibilityTree(node({ role: "heading", level: 1 }))).role).toBe("H1");
    // Clamp: an out-of-range / absent level collapses into the valid band.
    expect(nonNull(mapAccessibilityTree(node({ role: "heading", level: 9 }))).role).toBe("H6");
    expect(nonNull(mapAccessibilityTree(node({ role: "heading", level: 0 }))).role).toBe("H1");
    expect(nonNull(mapAccessibilityTree(node({ role: "heading" }))).role).toBe("H1");
  });

  it("maps a labeled image to Figure carrying its alt text", () => {
    const fig = nonNull(mapAccessibilityTree(node({ role: "img", name: "A red barn" })));
    expect(fig.role).toBe("Figure");
    expect(fig.alt).toBe("A red barn");
  });

  it("DROPS a decorative image (name === \"\")", () => {
    expect(mapAccessibilityTree(node({ role: "img", name: "" }))).toBeNull();
  });

  it("DROPS banner / contentinfo / separator (no node)", () => {
    expect(mapAccessibilityTree(node({ role: "banner" }))).toBeNull();
    expect(mapAccessibilityTree(node({ role: "contentinfo" }))).toBeNull();
    expect(mapAccessibilityTree(node({ role: "separator" }))).toBeNull();
  });

  it("prunes a dropped child but keeps the surviving siblings under the parent", () => {
    const doc = nonNull(
      mapAccessibilityTree(
        node({
          role: "document",
          children: [node({ role: "paragraph" }), node({ role: "banner" })],
        }),
      ),
    );
    expect(doc.role).toBe("Document");
    // The banner produced no node; only the paragraph survives.
    expect(doc.children.length).toBe(1);
    const onlyChild: PdfStructureNode = nonNull(doc.children[0] ?? null, "first child");
    expect(onlyChild.role).toBe("P");
  });

  it("drops a dropped container's entire subtree (no hoist)", () => {
    // A dropped banner that itself has a mapped paragraph child: the banner AND
    // its paragraph both vanish. T3 tags running header/footer content as
    // /Artifact and emits no MCID for it, so a surfaced (hoisted) paragraph
    // would be a dangling empty-/K "ghost" structure node.
    const doc = nonNull(
      mapAccessibilityTree(
        node({
          role: "document",
          children: [
            node({ role: "banner", children: [node({ role: "paragraph" })] }),
          ],
        }),
      ),
    );
    expect(doc.role).toBe("Document");
    expect(doc.children.length).toBe(0);
  });

  it("excludes a dropped container's WHOLE subtree, incl. a labeled image (T5 ghost-node guard)", () => {
    // A contentinfo (footer) with a paragraph child contributes ZERO nodes. And
    // a LABELED image (which would otherwise be a Figure) nested under a dropped
    // banner does NOT surface at the parent — the entire running-content subtree
    // is excluded. This is the assertion the old hoist failed: a hoisted Figure
    // (or P) would reference no marked content in T5.
    const doc = nonNull(
      mapAccessibilityTree(
        node({
          role: "document",
          children: [
            node({ role: "contentinfo", children: [node({ role: "paragraph" })] }),
            node({
              role: "banner",
              children: [node({ role: "img", name: "A logo" })],
            }),
          ],
        }),
      ),
    );
    expect(doc.role).toBe("Document");
    // Both the contentinfo subtree and the banner (incl. its labeled image) vanish.
    expect(doc.children.length).toBe(0);
  });

  it("carries sourceBlockId through as a string blockId", () => {
    const id = asBlockId("blk-1");
    const p = nonNull(mapAccessibilityTree(node({ role: "paragraph", sourceBlockId: id })));
    expect(p.blockId).toBe("blk-1");
    // A null sourceBlockId carries through as null.
    const synthetic = nonNull(mapAccessibilityTree(node({ role: "list", sourceBlockId: null })));
    expect(synthetic.blockId).toBeNull();
  });

  it("recurses children depth-first, mapping nested structure", () => {
    const tree = nonNull(
      mapAccessibilityTree(
        node({
          role: "document",
          children: [
            node({
              role: "list",
              children: [node({ role: "listitem" }), node({ role: "listitem" })],
            }),
          ],
        }),
      ),
    );
    const list: PdfStructureNode = nonNull(tree.children[0] ?? null, "list");
    expect(list.role).toBe("L");
    expect(list.children.length).toBe(2);
    expect(nonNull(list.children[0] ?? null).role).toBe("LI");
  });
});
