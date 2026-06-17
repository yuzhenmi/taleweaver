/**
 * Integration: block-level `textAlign` attr → layout cascade threading.
 *
 * P1 of the textAlign feature (closes #310). The inline-bearing-leaf
 * components (paragraph / heading / list-item) build their `ElementBox.style`
 * from scratch and must forward the author's `textAlign` attr so the layout
 * cascade — which re-derives `computedStyle` from `node.style` only — sees
 * the alignment value. Before the fix the value lived solely on the render-
 * pass `view.computedStyle` and never reached layout, so the cascaded
 * `computedStyle.textAlign` was always the initial `"start"`.
 *
 * This phase has no visible geometry effect yet (the IFC still ignores
 * textAlign — that's P2). It verifies the threading at the cascade /
 * used-style level.
 */
import { describe, it, expect } from "vitest";
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { computeUsedStyle } from "../layout/used-style";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

/** Build a single-leaf-child document with the given leaf type + attrs. */
function buildLeafDoc(
  leafType: string,
  attrs: Record<string, unknown>,
): ReturnType<typeof buildState> {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "leaf", lastChildId: "leaf" }),
      buildBlock({
        id: "leaf",
        type: leafType,
        parentId: "doc",
        attrs,
        inlineContent: inlineContent([text("hello")]),
      }),
    ],
  });
}

/** Render + cascade a single-leaf doc, returning the cascaded leaf ElementBox. */
function cascadeLeaf(leafType: string, attrs: Record<string, unknown>): ElementBox {
  const state = buildLeafDoc(leafType, attrs);
  const renderOutput = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadePass(renderOutput.root);
  if (cascaded.type !== "element") throw new Error("expected element root");
  const leaf = findElementByKey(cascaded, "leaf");
  if (leaf === undefined) throw new Error("leaf ElementBox not found");
  return leaf;
}

function findElementByKey(node: RenderNode, key: string): ElementBox | undefined {
  if (node.type === "element") {
    if (node.key === key) return node;
    for (const child of node.children) {
      const found = findElementByKey(child, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const LEAF_TYPES = ["paragraph", "heading", "list-item"] as const;
const KEYWORDS = ["start", "end", "center", "justify"] as const;

describe("textAlign attr → layout cascade threading (#310 P1)", () => {
  it("flows a paragraph's textAlign attr to the cascaded computedStyle", () => {
    const leaf = cascadeLeaf("paragraph", { textAlign: "center" });
    expect(leaf.computedStyle?.textAlign).toBe("center");
  });

  it("flows a paragraph's textAlign attr through to the layout UsedStyle", () => {
    const leaf = cascadeLeaf("paragraph", { textAlign: "center" });
    if (leaf.computedStyle === undefined) throw new Error("missing computedStyle");
    const used = computeUsedStyle(leaf.computedStyle, 800, "indefinite");
    expect(used.textAlign).toBe("center");
  });

  for (const leafType of LEAF_TYPES) {
    describe(leafType, () => {
      for (const keyword of KEYWORDS) {
        it(`round-trips the "${keyword}" keyword to cascaded computedStyle`, () => {
          const leaf = cascadeLeaf(leafType, { textAlign: keyword });
          expect(leaf.computedStyle?.textAlign).toBe(keyword);
        });
      }

      it("rejects an invalid textAlign attr (falls back to initial 'start')", () => {
        const leaf = cascadeLeaf(leafType, { textAlign: "bogus" });
        expect(leaf.computedStyle?.textAlign).toBe("start");
      });

      it("leaves textAlign at the initial 'start' when the attr is absent", () => {
        const leaf = cascadeLeaf(leafType, {});
        expect(leaf.computedStyle?.textAlign).toBe("start");
      });
    });
  }

  it("does NOT regress whiteSpace forwarding on paragraph", () => {
    const leaf = cascadeLeaf("paragraph", { whiteSpace: "pre" });
    expect(leaf.computedStyle?.whiteSpace).toBe("pre");
  });
});

describe("lang attr → layout cascade threading (#527)", () => {
  it("flows a paragraph's lang attr to the cascaded computedStyle.language", () => {
    const leaf = cascadeLeaf("paragraph", { lang: "de" });
    expect(leaf.computedStyle?.language).toBe("de");
  });

  it("flows a paragraph's lang attr through to the layout UsedStyle", () => {
    const leaf = cascadeLeaf("paragraph", { lang: "fr-CA" });
    if (leaf.computedStyle === undefined) throw new Error("missing computedStyle");
    const used = computeUsedStyle(leaf.computedStyle, 800, "indefinite");
    expect(used.language).toBe("fr-CA");
  });

  for (const leafType of LEAF_TYPES) {
    describe(leafType, () => {
      it("round-trips a BCP-47 tag verbatim to cascaded computedStyle", () => {
        const leaf = cascadeLeaf(leafType, { lang: "en-GB" });
        expect(leaf.computedStyle?.language).toBe("en-GB");
      });

      it("drops an empty lang attr (falls back to the initial '')", () => {
        const leaf = cascadeLeaf(leafType, { lang: "" });
        expect(leaf.computedStyle?.language).toBe("");
      });

      it("leaves language at the initial '' when the attr is absent", () => {
        const leaf = cascadeLeaf(leafType, {});
        expect(leaf.computedStyle?.language).toBe("");
      });
    });
  }

  // The path that lights up PDF /Lang + per-block hyphenation: a document-level
  // `lang` inherits (language is inherits:true) to every descendant block, so a
  // child paragraph with NO own lang attr still carries the document language in
  // its cascaded computedStyle. The controller's firstBodyLanguage walk reads
  // exactly this off the body text-runs.
  it("inherits a document-level lang attr down to a child paragraph", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          attrs: { lang: "ja" },
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const renderOutput = render(state, componentRegistry, attrRegistry);
    const cascaded = cascadePass(renderOutput.root);
    if (cascaded.type !== "element") throw new Error("expected element root");
    expect(cascaded.computedStyle?.language).toBe("ja");
    const child = findElementByKey(cascaded, "p");
    if (child === undefined) throw new Error("child paragraph not found");
    expect(child.computedStyle?.language).toBe("ja");
  });
});

describe("writingMode attr → layout cascade threading (P3.3)", () => {
  const WRITING_MODES = ["horizontal-tb", "vertical-rl", "vertical-lr"] as const;

  it("flows a paragraph's writingMode attr to the cascaded computedStyle", () => {
    const leaf = cascadeLeaf("paragraph", { writingMode: "vertical-rl" });
    expect(leaf.computedStyle?.writingMode).toBe("vertical-rl");
  });

  it("flows a paragraph's writingMode attr through to the layout UsedStyle", () => {
    const leaf = cascadeLeaf("paragraph", { writingMode: "vertical-lr" });
    if (leaf.computedStyle === undefined) throw new Error("missing computedStyle");
    const used = computeUsedStyle(leaf.computedStyle, 800, "indefinite");
    expect(used.writingMode).toBe("vertical-lr");
  });

  for (const leafType of LEAF_TYPES) {
    describe(leafType, () => {
      for (const wm of WRITING_MODES) {
        it(`round-trips the "${wm}" keyword to cascaded computedStyle`, () => {
          const leaf = cascadeLeaf(leafType, { writingMode: wm });
          expect(leaf.computedStyle?.writingMode).toBe(wm);
        });
      }

      it("rejects an invalid writingMode attr (falls back to initial 'horizontal-tb')", () => {
        const leaf = cascadeLeaf(leafType, { writingMode: "sideways-lr" });
        expect(leaf.computedStyle?.writingMode).toBe("horizontal-tb");
      });

      it("leaves writingMode at the initial 'horizontal-tb' when the attr is absent", () => {
        const leaf = cascadeLeaf(leafType, {});
        expect(leaf.computedStyle?.writingMode).toBe("horizontal-tb");
      });
    });
  }
});
